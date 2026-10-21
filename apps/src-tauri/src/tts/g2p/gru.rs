//! The last resort for a word no lexicon knows: a small sequence-to-sequence
//! GRU (letters in, phones out), run here in plain Rust.
//!
//! The weights ship in the voice pack (`g2p/g2p-en-oov.bin`): g2p_en 2.1.0's
//! `checkpoint20.npz` (Apache-2.0, github.com/Kyubyong/g2p; trained on
//! CMUdict), rewritten by `scripts/g2p_prep.py` as a text header and
//! little-endian f32s:
//!
//! ```text
//! LFG2P 1
//! output arpabet
//! graphemes <pad> <unk> </s> a b c …
//! phonemes <pad> <unk> <s> </s> AA0 …
//! start 2 / end 3 / unknown 1 / grapheme_end 2
//! tensor enc_emb 29 256          (one line per tensor, in data order)
//! …
//! data
//! <f32 LE …>
//! ```
//!
//! Any model of the same shape works (another vocabulary, a model trained on
//! misaki's own lexicons with `output misaki`).

use std::collections::HashMap;

/// What the model's phones are.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Output {
  /// CMUdict's ARPAbet (with stress digits): mapped by `arpabet.rs`.
  Arpabet,
  /// misaki's symbols already.
  Misaki,
}

struct Matrix {
  rows: usize,
  cols: usize,
  data: Vec<f32>,
}

impl Matrix {
  fn row(&self, row: usize) -> &[f32] {
    &self.data[row * self.cols..(row + 1) * self.cols]
  }

  /// `out = self · x + bias`
  fn mul_add(&self, x: &[f32], bias: &[f32], out: &mut [f32]) {
    for (row, slot) in out.iter_mut().enumerate().take(self.rows) {
      let weights = self.row(row);
      let mut sum = bias[row];
      for (w, v) in weights.iter().zip(x) {
        sum += w * v;
      }
      *slot = sum;
    }
  }
}

struct Gru {
  w_ih: Matrix,
  w_hh: Matrix,
  b_ih: Vec<f32>,
  b_hh: Vec<f32>,
}

fn sigmoid(x: f32) -> f32 {
  1.0 / (1.0 + (-x).exp())
}

impl Gru {
  fn hidden(&self) -> usize {
    self.w_hh.cols
  }

  /// One step, as PyTorch's GRUCell (gates r, z, n).
  fn step(&self, x: &[f32], h: &mut [f32], scratch: &mut (Vec<f32>, Vec<f32>)) {
    let size = self.hidden();
    let (ih, hh) = scratch;
    ih.resize(3 * size, 0.0);
    hh.resize(3 * size, 0.0);
    self.w_ih.mul_add(x, &self.b_ih, ih);
    self.w_hh.mul_add(h, &self.b_hh, hh);
    for i in 0..size {
      let r = sigmoid(ih[i] + hh[i]);
      let z = sigmoid(ih[size + i] + hh[size + i]);
      let n = (ih[2 * size + i] + r * hh[2 * size + i]).tanh();
      h[i] = (1.0 - z) * n + z * h[i];
    }
  }
}

pub struct Model {
  output: Output,
  graphemes: HashMap<char, usize>,
  grapheme_end: usize,
  unknown: usize,
  phonemes: Vec<String>,
  start: usize,
  end: usize,
  enc_emb: Matrix,
  encoder: Gru,
  dec_emb: Matrix,
  decoder: Gru,
  fc_w: Matrix,
  fc_b: Vec<f32>,
}

fn take_header(bytes: &[u8]) -> Result<(Vec<&str>, &[u8]), String> {
  let mut lines = Vec::new();
  let mut at = 0;
  loop {
    let end = bytes[at..].iter().position(|&b| b == b'\n').map(|p| at + p).ok_or("the G2P model has no data")?;
    let line = std::str::from_utf8(&bytes[at..end]).map_err(|_| "the G2P model's header is not text")?;
    at = end + 1;
    if line == "data" {
      return Ok((lines, &bytes[at..]));
    }
    lines.push(line);
    if lines.len() > 1000 {
      return Err("the G2P model's header has no end".into());
    }
  }
}

impl Model {
  pub fn parse(bytes: &[u8]) -> Result<Model, String> {
    let (header, mut data) = take_header(bytes)?;
    if header.first() != Some(&"LFG2P 1") {
      return Err("not a Leaflet G2P model".into());
    }
    let mut fields: HashMap<&str, &str> = HashMap::new();
    let mut tensors: HashMap<&str, Matrix> = HashMap::new();
    for line in &header[1..] {
      let (key, rest) = line.split_once(' ').unwrap_or((line, ""));
      if key != "tensor" {
        fields.insert(key, rest);
        continue;
      }
      let mut parts = rest.split_whitespace();
      let name = parts.next().ok_or("a tensor without a name")?;
      let dims: Vec<usize> = parts.map(|d| d.parse().map_err(|_| "a bad tensor size".to_string())).collect::<Result<_, _>>()?;
      let (rows, cols) = match dims.as_slice() {
        [n] => (1, *n),
        [r, c] => (*r, *c),
        _ => return Err(format!("tensor {name} is not 1D or 2D")),
      };
      let len = rows * cols * 4;
      if data.len() < len {
        return Err("the G2P model is cut short".into());
      }
      let values = data[..len].chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect();
      data = &data[len..];
      tensors.insert(name, Matrix { rows, cols, data: values });
    }
    let mut take = |name: &str| tensors.remove(name).ok_or_else(|| format!("the G2P model lacks {name}"));
    let vector = |m: Matrix| m.data;
    let enc_emb = take("enc_emb")?;
    let encoder = Gru { w_ih: take("enc_w_ih")?, w_hh: take("enc_w_hh")?, b_ih: vector(take("enc_b_ih")?), b_hh: vector(take("enc_b_hh")?) };
    let dec_emb = take("dec_emb")?;
    let decoder = Gru { w_ih: take("dec_w_ih")?, w_hh: take("dec_w_hh")?, b_ih: vector(take("dec_b_ih")?), b_hh: vector(take("dec_b_hh")?) };
    let fc_w = take("fc_w")?;
    let fc_b = vector(take("fc_b")?);
    let number = |key: &str| -> Result<usize, String> { fields.get(key).and_then(|v| v.trim().parse().ok()).ok_or_else(|| format!("the G2P model lacks `{key}`")) };
    let graphemes: Vec<&str> = fields.get("graphemes").ok_or("the G2P model lacks graphemes")?.split_whitespace().collect();
    let phonemes: Vec<String> = fields.get("phonemes").ok_or("the G2P model lacks phonemes")?.split_whitespace().map(str::to_string).collect();
    let output = match fields.get("output").copied() {
      Some("arpabet") => Output::Arpabet,
      Some("misaki") => Output::Misaki,
      other => return Err(format!("the G2P model's output {other:?} is not known")),
    };
    let hidden = encoder.hidden();
    let consistent = enc_emb.rows == graphemes.len()
      && dec_emb.rows == phonemes.len()
      && fc_w.rows == phonemes.len()
      && fc_w.cols == hidden
      && decoder.hidden() == hidden
      && encoder.w_ih.cols == enc_emb.cols
      && decoder.w_ih.cols == dec_emb.cols
      && encoder.w_ih.rows == 3 * hidden
      && decoder.w_ih.rows == 3 * hidden
      && encoder.b_ih.len() == 3 * hidden
      && decoder.b_hh.len() == 3 * hidden
      && fc_b.len() == phonemes.len();
    if !consistent {
      return Err("the G2P model's tensors do not fit together".into());
    }
    let grapheme_index = graphemes.iter().enumerate().filter_map(|(i, g)| {
      let mut chars = g.chars();
      match (chars.next(), chars.next()) {
        (Some(c), None) => Some((c, i)),
        _ => None,
      }
    });
    Ok(Model {
      output,
      graphemes: grapheme_index.collect(),
      grapheme_end: number("grapheme_end")?,
      unknown: number("unknown")?,
      start: number("start")?,
      end: number("end")?,
      phonemes,
      enc_emb,
      encoder,
      dec_emb,
      decoder,
      fc_w,
      fc_b,
    })
  }

  pub fn output(&self) -> Output {
    self.output
  }

  /// The word's phones (space-separated), greedy. `word` is lower case.
  pub fn predict(&self, word: &str) -> String {
    let hidden = self.encoder.hidden();
    let mut h = vec![0.0f32; hidden];
    let mut scratch = (Vec::new(), Vec::new());
    let letters: Vec<usize> = word.chars().map(|c| self.graphemes.get(&c).copied().unwrap_or(self.unknown)).chain([self.grapheme_end]).collect();
    for &letter in &letters {
      self.encoder.step(self.enc_emb.row(letter), &mut h, &mut scratch);
    }
    let mut out: Vec<&str> = Vec::new();
    let mut previous = self.start;
    let mut logits = vec![0.0f32; self.phonemes.len()];
    // g2p_en stops at 20; a long word may need more.
    let limit = (letters.len() + 10).max(20);
    for _ in 0..limit {
      self.decoder.step(self.dec_emb.row(previous), &mut h, &mut scratch);
      self.fc_w.mul_add(&h, &self.fc_b, &mut logits);
      let best = logits.iter().enumerate().fold((0, f32::MIN), |best, (i, &v)| if v > best.1 { (i, v) } else { best }).0;
      if best == self.end {
        break;
      }
      if best > self.end {
        out.push(&self.phonemes[best]);
      }
      previous = best;
    }
    out.join(" ")
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn reads_and_predicts() {
    // Build the tiny model with the decoder's n-gate weight set: after <s>
    // (embedding 0) h stays 0, so the logits are the bias: AA1 wins first,
    // then, after AA1 (embedding 1), h > 0 and </s> wins.
    let header = "LFG2P 1\noutput arpabet\ngraphemes <pad> <unk> </s> a\nphonemes <pad> <unk> <s> </s> AA1\nstart 2\nend 3\nunknown 1\ngrapheme_end 2\n\
      tensor enc_emb 4 1\ntensor enc_w_ih 3 1\ntensor enc_w_hh 3 1\ntensor enc_b_ih 3\ntensor enc_b_hh 3\n\
      tensor dec_emb 5 1\ntensor dec_w_ih 3 1\ntensor dec_w_hh 3 1\ntensor dec_b_ih 3\ntensor dec_b_hh 3\n\
      tensor fc_w 5 1\ntensor fc_b 5\ndata\n";
    let mut bytes = header.as_bytes().to_vec();
    let mut put = |values: &[f32]| values.iter().for_each(|v| bytes.extend_from_slice(&v.to_le_bytes()));
    put(&[0.0; 4]);
    put(&[0.0; 3]);
    put(&[0.0; 3]);
    put(&[0.0; 3]);
    put(&[0.0; 3]);
    put(&[0.0, 0.0, 0.0, 0.0, 4.0]); // dec_emb: AA1 → 4
    put(&[0.0, 0.0, 1.0]); // dec_w_ih: input to the n gate
    put(&[0.0; 3]);
    put(&[0.0; 3]);
    put(&[0.0; 3]);
    put(&[0.0, 0.0, 0.0, 10.0, 0.0]); // fc_w: h → </s>
    put(&[0.0, 0.0, 0.0, 0.0, 1.0]); // fc_b: AA1 first
    let model = Model::parse(&bytes).unwrap();
    assert_eq!(model.output(), Output::Arpabet);
    assert_eq!(model.predict("a"), "AA1");
  }

  #[test]
  fn refuses_damage() {
    assert!(Model::parse(b"LFG2P 1\noutput arpabet\ntensor enc_emb 4 1\ndata\n").is_err());
    assert!(Model::parse(b"nope").is_err());
  }
}
