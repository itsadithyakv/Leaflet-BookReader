/**
 * The radio's sound, made on the spot with Web Audio. No files and nothing
 * fetched: a scene (scenes.ts) is a few loops of noise through filters that
 * play all the time, and short sounds and slow changes laid onto the audio
 * clock a few seconds ahead from a schedule (schedule.ts). So it works with
 * no network, under the release build's content policy, and never comes
 * round to the same moment again.
 *
 * It is kept light: a couple of dozen plain nodes a scene (the cafe, with
 * its voices and its room, about sixty), no script running per sample, a
 * timer twice a second. When nothing should be heard the context is
 * suspended, which stops the audio thread's work altogether.
 *
 * `buildScene` and `renderScene` work on any context, so the same graph the
 * reader hears can be rendered offline and measured (measure.ts).
 */
import { NOISE_SECONDS, noiseLoop, noisePair, renderGrain, renderRoom } from "./grains";
import { volumeGain } from "./prefs";
import { freshSeed, seeded, type Random } from "./random";
import { createSchedule, GRAIN_VARIANTS, type Schedule, type SceneEvent } from "./schedule";
import { SCENES, sceneGrains, type GrainKind, type NoiseColour, type ParamRef, type SceneDef, type SceneId, type SceneOption } from "./scenes";

/** How far ahead of the audio clock events are laid down, and how often more are. */
const LOOKAHEAD_SECONDS = 3;
const TICK_MS = 500;
/** Fading in, out and between scenes: `tau` is the time to two thirds of the way; all but there (under a hundredth left) after five. */
const FADE_TAU = 0.35;
const FADE_MS = FADE_TAU * 5 * 1000;
/** A turn of the volume slider: quick, and still no click. */
const VOLUME_TAU = 0.05;
/** A short sound this late (a stalled timer) is dropped, not played in a heap with the others. */
const LATE_SECONDS = 0.05;
/** How much later a room's echo reaches the right ear than the left. */
const ROOM_WIDTH_SECONDS = 0.019;
/** Where short sounds can sit between the ears: a few fixed places, so each needs no panner of its own. */
const PANS = [-0.8, -0.4, 0, 0.4, 0.8];

// ---- the raw material, made once for a context ----------------------------------------------

type Kit = {
  random: Random;
  noise: Map<NoiseColour, AudioBuffer>;
  /** The same colours for one ear, for a layer that is placed between the two. */
  mono: Map<NoiseColour, AudioBuffer>;
  grains: Map<GrainKind, AudioBuffer[]>;
  rooms: Map<number, AudioBuffer>;
};

const kits = new WeakMap<BaseAudioContext, Kit>();

const kitFor = (ctx: BaseAudioContext, random: Random): Kit => {
  let kit = kits.get(ctx);
  if (!kit) {
    kit = { random, noise: new Map(), mono: new Map(), grains: new Map(), rooms: new Map() };
    kits.set(ctx, kit);
  }
  return kit;
};

const pairBuffer = (ctx: BaseAudioContext, [left, right]: [Float32Array, Float32Array]) => {
  const buffer = ctx.createBuffer(2, left.length, ctx.sampleRate);
  buffer.getChannelData(0).set(left);
  buffer.getChannelData(1).set(right);
  return buffer;
};

const noiseFor = (ctx: BaseAudioContext, kit: Kit, colour: NoiseColour) => {
  let buffer = kit.noise.get(colour);
  if (!buffer) {
    buffer = pairBuffer(ctx, noisePair(colour, ctx.sampleRate, kit.random));
    kit.noise.set(colour, buffer);
  }
  return buffer;
};

const monoFor = (ctx: BaseAudioContext, kit: Kit, colour: NoiseColour) => {
  let buffer = kit.mono.get(colour);
  if (!buffer) {
    const samples = noiseLoop(colour, NOISE_SECONDS[colour], ctx.sampleRate, kit.random);
    buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buffer.getChannelData(0).set(samples);
    kit.mono.set(colour, buffer);
  }
  return buffer;
};

const grainsFor = (ctx: BaseAudioContext, kit: Kit, kind: GrainKind) => {
  let buffers = kit.grains.get(kind);
  if (!buffers) {
    buffers = Array.from({ length: GRAIN_VARIANTS }, () => {
      const samples = renderGrain(kind, ctx.sampleRate, kit.random);
      const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      buffer.getChannelData(0).set(samples);
      return buffer;
    });
    kit.grains.set(kind, buffers);
  }
  return buffers;
};

const roomFor = (ctx: BaseAudioContext, kit: Kit, seconds: number) => {
  let buffer = kit.rooms.get(seconds);
  if (!buffer) {
    const echo = renderRoom(seconds, ctx.sampleRate, kit.random);
    buffer = ctx.createBuffer(1, echo.length, ctx.sampleRate);
    buffer.getChannelData(0).set(echo);
    kit.rooms.set(seconds, buffer);
  }
  return buffer;
};

// ---- a scene, as nodes ---------------------------------------------------------------------

export type SceneGraph = {
  scene: SceneDef;
  /** Where the scene comes out, at its own level. */
  out: GainNode;
  /** Puts events on the audio clock, `origin` being the clock's time at the scene's start. */
  apply: (events: SceneEvent[], origin: number) => void;
  /** Sends controls back to where they rest (a switch turned off part-way through a roll of thunder). */
  settle: (params: ParamRef[]) => void;
  /** Stops everything and lets go of it. */
  stop: () => void;
  /** How many nodes play all the time (each short sound adds two for as long as it lasts). */
  nodes: number;
};

/**
 * Builds a scene's layers on a context and starts them. `random` picks where
 * each loop starts and, the first time on a context, makes the noise and the
 * short sounds themselves.
 */
export const buildScene = (ctx: BaseAudioContext, scene: SceneDef, random: Random): SceneGraph => {
  const kit = kitFor(ctx, random);
  let nodes = 0;
  const count = <Node extends AudioNode>(node: Node) => {
    nodes += 1;
    return node;
  };
  const out = count(ctx.createGain());
  out.gain.value = scene.level;
  const sources: AudioScheduledSourceNode[] = [];
  const params = new Map<ParamRef, { param: AudioParam; rest: number }>();

  // The room: everything sent to it comes back as its echo.
  let room: GainNode | null = null;
  if (scene.room) {
    const echo = count(ctx.createConvolver());
    echo.normalize = false;
    echo.buffer = roomFor(ctx, kit, scene.room.seconds);
    // One echo, of everything sent together: an echo worked out for each ear
    // would cost twice as much (it is the dearest single node there is). The
    // same echo reaches the right ear a moment after the left, which is
    // enough for the two to be heard as a room around, not a point ahead.
    echo.channelCount = 1;
    echo.channelCountMode = "explicit";
    const late = count(ctx.createDelay(0.05));
    late.delayTime.value = ROOM_WIDTH_SECONDS;
    const ears = count(ctx.createChannelMerger(2));
    echo.connect(ears, 0, 0);
    echo.connect(late).connect(ears, 0, 1);
    ears.connect(out);
    room = count(ctx.createGain());
    room.connect(echo);
  }

  // One way into the room for each amount sent: five voices share theirs.
  const sends = new Map<number, GainNode>();
  const sendFor = (amount: number, into: GainNode) => {
    let send = sends.get(amount);
    if (!send) {
      send = count(ctx.createGain());
      send.gain.value = amount;
      send.connect(into);
      sends.set(amount, send);
    }
    return send;
  };

  // Noise in two channels where it is to fill the width; in one where the
  // layer is put in a place (everything after it then works on one channel,
  // not two).
  const loop = (colour: NoiseColour, speed: number, placed: boolean) => {
    const source = count(ctx.createBufferSource());
    source.buffer = placed ? monoFor(ctx, kit, colour) : noiseFor(ctx, kit, colour);
    source.loop = true;
    source.playbackRate.value = speed;
    // Anywhere in the loop: two layers of one colour are never the same noise at once.
    source.start(0, random() * source.buffer.duration);
    sources.push(source);
    return source;
  };

  for (const layer of scene.layers) {
    const gain = count(ctx.createGain());
    gain.gain.value = layer.gain;
    params.set(`${layer.id}.gain`, { param: gain.gain, rest: layer.gain });
    const filters = layer.filters.map((def, index) => {
      const filter = count(ctx.createBiquadFilter());
      filter.type = def.type;
      filter.frequency.value = def.freq;
      filter.Q.value = def.q ?? 0.7;
      // A frequency that drifts is followed block by block, not sample by
      // sample: the drift is slow, and working a filter out afresh for every
      // sample is most of what a scene would otherwise cost.
      filter.frequency.automationRate = "k-rate";
      if (def.db !== undefined) {
        filter.gain.value = def.db;
      }
      params.set(`${layer.id}.f${index}`, { param: filter.frequency, rest: def.freq });
      return filter;
    });
    const chain: AudioNode[] = [...filters, gain];
    for (let index = 0; index < chain.length - 1; index += 1) {
      chain[index].connect(chain[index + 1]);
    }
    if ("noise" in layer.source) {
      loop(layer.source.noise, layer.source.speed ?? 1, layer.pan !== undefined).connect(chain[0]);
    } else {
      // A voice: the buzz of its cords.
      const buzz = count(ctx.createOscillator());
      buzz.type = "sawtooth";
      buzz.frequency.value = layer.source.buzz;
      // Followed block by block, like a filter's frequency: a voice's pitch moves slowly.
      buzz.frequency.automationRate = "k-rate";
      params.set(`${layer.id}.pitch`, { param: buzz.frequency, rest: layer.source.buzz });
      buzz.connect(chain[0]);
      buzz.start(0);
      sources.push(buzz);
    }
    let last: AudioNode = gain;
    if (layer.pan !== undefined) {
      const panner = count(ctx.createStereoPanner());
      panner.pan.value = layer.pan;
      gain.connect(panner);
      last = panner;
    }
    last.connect(out);
    if (room && layer.wet) {
      last.connect(sendFor(layer.wet, room));
    }
  }

  // Short sounds: made ready now, and a place between the ears for each to be played into.
  const kinds = sceneGrains(scene);
  kinds.forEach((kind) => grainsFor(ctx, kit, kind));
  const places: StereoPannerNode[] = [];
  if (kinds.length > 0) {
    const send = room && scene.room ? sendFor(scene.room.grains, room) : null;
    for (const pan of PANS) {
      const place = count(ctx.createStereoPanner());
      place.pan.value = pan;
      place.connect(out);
      if (send) {
        place.connect(send);
      }
      places.push(place);
    }
  }
  const placeFor = (pan: number) => places[Math.max(0, Math.min(places.length - 1, Math.round((pan - PANS[0]) / (PANS[1] - PANS[0]))))];

  return {
    scene,
    out,
    apply: (events, origin) => {
      const now = ctx.currentTime;
      for (const event of events) {
        const at = origin + event.at;
        if (event.kind === "ramp") {
          // Late or not, a control still has to end up where it was sent.
          params.get(event.param)?.param.setTargetAtTime(event.to, Math.max(at, now), Math.max(0.001, event.tau));
          continue;
        }
        if (at < now - LATE_SECONDS) {
          continue;
        }
        const buffers = kit.grains.get(event.grain);
        if (!buffers || places.length === 0) {
          continue;
        }
        const source = ctx.createBufferSource();
        source.buffer = buffers[event.variant % buffers.length];
        source.playbackRate.value = event.speed;
        const gain = ctx.createGain();
        gain.gain.value = event.gain;
        source.connect(gain).connect(placeFor(event.pan));
        source.onended = () => gain.disconnect();
        source.start(Math.max(at, now));
      }
    },
    settle: (refs) => {
      const now = ctx.currentTime;
      for (const ref of refs) {
        const found = params.get(ref);
        if (found) {
          found.param.cancelScheduledValues(now);
          found.param.setTargetAtTime(found.rest, now, 0.4);
        }
      }
    },
    stop: () => {
      for (const source of sources) {
        try {
          source.stop();
        } catch {
          // Already stopped.
        }
      }
      out.disconnect();
    },
    nodes
  };
};

// ---- the way out ----------------------------------------------------------------------------

/** Below this the way out changes nothing; above it, a peak is rounded off instead of being cut flat. */
const CEILING_KNEE = 0.8;

/** The rounding-off, as a curve from -1 to 1: a straight line to the knee, then easing towards 0.95. */
const ceilingCurve = () => {
  const points = 2049;
  const curve = new Float32Array(points);
  for (let index = 0; index < points; index += 1) {
    const level = (index / (points - 1)) * 2 - 1;
    const size = Math.abs(level);
    const eased = size <= CEILING_KNEE ? size : CEILING_KNEE + (1 - CEILING_KNEE) * Math.tanh((size - CEILING_KNEE) / (1 - CEILING_KNEE));
    curve[index] = Math.sign(level) * eased;
  }
  return curve;
};

/**
 * The master volume and what follows it. The scenes are set so that, at
 * full volume, their peaks stay under the knee (measured over minutes); a
 * rare louder moment (a pop on top of a swell) is rounded, never clipped.
 */
const wayOut = (ctx: BaseAudioContext, level: number) => {
  const master = ctx.createGain();
  master.gain.value = level;
  const ceiling = ctx.createWaveShaper();
  ceiling.curve = ceilingCurve();
  master.connect(ceiling).connect(ctx.destination);
  return master;
};

// ---- a scene rendered, to be measured ---------------------------------------------------------

export type Rendered = {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  /** How long the render took, for a sense of what the scene costs. */
  renderMs: number;
  nodes: number;
  /** How many events the schedule laid down, and how many of them were short sounds. */
  events: number;
  grains: number;
};

type RenderOptions = { volume?: number; thunder?: boolean; sampleRate?: number };

/**
 * Renders a stretch of a scene offline, as fast as the machine can, through
 * the same graph and schedule the reader hears. The same seed gives the same
 * samples; another seed gives another shower. A scene can be given whole
 * instead of by name, to try one out before it is in the table.
 */
export const renderScene = async (
  which: SceneId | SceneDef,
  seconds: number,
  seed: number,
  { volume = 1, thunder = true, sampleRate = 44100 }: RenderOptions = {}
): Promise<Rendered> => {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  const scene = typeof which === "string" ? SCENES[which] : which;
  const graph = buildScene(ctx, scene, seeded(seed));
  graph.out.connect(wayOut(ctx, volumeGain(volume)));
  const schedule = createSchedule(scene, seed, thunder ? [] : ["thunder"]);
  let events = 0;
  let grains = 0;
  // Laid down a few seconds ahead, as the radio does it: with every short
  // sound of a long stretch waiting in the graph at once, the render would
  // measure the waiting, not the scene.
  const lay = (until: number) => {
    const next = schedule.until(until);
    events += next.length;
    grains += next.filter((event) => event.kind === "grain").length;
    graph.apply(next, 0);
  };
  lay(LOOKAHEAD_SECONDS);
  const stride = LOOKAHEAD_SECONDS - 1;
  for (let at = stride; at < seconds; at += stride) {
    void ctx.suspend(at).then(() => {
      lay(at + LOOKAHEAD_SECONDS);
      return ctx.resume();
    });
  }
  const started = performance.now();
  const buffer = await ctx.startRendering();
  return {
    left: buffer.getChannelData(0),
    right: buffer.getChannelData(1),
    sampleRate,
    renderMs: performance.now() - started,
    nodes: graph.nodes,
    events,
    grains
  };
};

// ---- the radio itself --------------------------------------------------------------------

export type EngineTarget = {
  scene: SceneId;
  volume: number;
  thunder: boolean;
  /** Sounding; quiet but kept (the window is away); or put away. */
  mode: "play" | "rest" | "stop";
};

export type EngineStatus = {
  /** The audio context: not made yet, or what it says of itself. */
  context: "none" | AudioContextState;
  scene: SceneId | null;
  /** The master level as it is this instant: it moves during a fade. */
  gain: number;
  nodes: number;
  time: number;
  /** Events laid down since the scene started. */
  events: number;
};

type Playing = {
  id: SceneId;
  graph: SceneGraph;
  schedule: Schedule;
  /** The scene's own fader, for changing from one scene to the next. */
  fade: GainNode;
  origin: number;
  events: number;
};

export type Engine = {
  /** Brings the sound to what is wanted. Safe to call as often as anything changes. */
  sync: (target: EngineTarget) => void;
  status: () => EngineStatus;
};

export const createEngine = (): Engine => {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let playing: Playing | null = null;
  let ticker: number | null = null;
  let winding: number | null = null;
  let mode: EngineTarget["mode"] = "stop";
  let muted: SceneOption[] = [];
  let waitingForGesture = false;

  const context = () => {
    if (typeof window === "undefined") {
      return null;
    }
    if (!ctx) {
      const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) {
        return null;
      }
      // "playback": larger blocks, less work; nothing here needs to answer a finger in milliseconds.
      ctx = new Context({ latencyHint: "playback" });
      master = wayOut(ctx, 0);
    }
    return ctx;
  };

  const tick = () => {
    if (!ctx || !playing || ctx.state !== "running") {
      return;
    }
    const events = playing.schedule.until(ctx.currentTime - playing.origin + LOOKAHEAD_SECONDS);
    playing.events += events.length;
    playing.graph.apply(events, playing.origin);
  };

  const stopTicking = () => {
    if (ticker !== null) {
      window.clearInterval(ticker);
      ticker = null;
    }
  };

  const cancelWinding = () => {
    if (winding !== null) {
      window.clearTimeout(winding);
      winding = null;
    }
  };

  /**
   * A webview will not start audio before the page has been clicked or typed
   * in. Opening a book is a click, so this is rare; when it happens the
   * sound starts with the reader's next one.
   */
  const wake = () => {
    if (!ctx || ctx.state !== "suspended") {
      return;
    }
    void ctx.resume().then(tick, () => undefined);
    if (waitingForGesture) {
      return;
    }
    waitingForGesture = true;
    const onGesture = () => {
      waitingForGesture = false;
      window.removeEventListener("pointerdown", onGesture, true);
      window.removeEventListener("keydown", onGesture, true);
      if (mode === "play") {
        wake();
      }
    };
    window.addEventListener("pointerdown", onGesture, true);
    window.addEventListener("keydown", onGesture, true);
  };

  const start = (audio: AudioContext, id: SceneId) => {
    const out = master;
    if (!out) {
      return;
    }
    const now = audio.currentTime;
    const before = playing;
    if (before) {
      // The scene before fades under the new one, then goes.
      before.fade.gain.setTargetAtTime(0, now, FADE_TAU);
      window.setTimeout(() => {
        before.graph.stop();
        before.fade.disconnect();
      }, FADE_MS);
    }
    const scene = SCENES[id];
    const seed = freshSeed();
    const graph = buildScene(audio, scene, seeded(seed));
    const fade = audio.createGain();
    fade.gain.value = before ? 0 : 1;
    if (before) {
      fade.gain.setTargetAtTime(1, now, FADE_TAU);
    }
    graph.out.connect(fade).connect(out);
    playing = { id, graph, schedule: createSchedule(scene, seed, muted), fade, origin: now, events: 0 };
  };

  return {
    sync: (target) => {
      const wantMuted: SceneOption[] = target.thunder ? [] : ["thunder"];
      if (target.mode !== "play") {
        mode = target.mode;
        muted = wantMuted;
        if (!ctx || !master) {
          return;
        }
        // Down to nothing, then the audio thread is let go: kept for "rest", taken apart for "stop".
        master.gain.setTargetAtTime(0, ctx.currentTime, FADE_TAU);
        cancelWinding();
        const audio = ctx;
        winding = window.setTimeout(() => {
          winding = null;
          stopTicking();
          if (mode === "stop" && playing) {
            playing.graph.stop();
            playing.fade.disconnect();
            playing = null;
          }
          void audio.suspend().catch(() => undefined);
        }, FADE_MS);
        return;
      }
      const audio = context();
      if (!audio || !master) {
        return;
      }
      try {
        mode = "play";
        cancelWinding();
        const changed = muted.join() !== wantMuted.join();
        muted = wantMuted;
        if (!playing || playing.id !== target.scene) {
          start(audio, target.scene);
        } else if (changed) {
          const live = playing;
          SCENES[live.id].options?.forEach((option) => {
            const off = muted.includes(option);
            live.schedule.mute(option, off);
            if (off) {
              live.graph.settle(live.schedule.paramsOf(option));
            }
          });
        }
        wake();
        master.gain.setTargetAtTime(volumeGain(target.volume), audio.currentTime, master.gain.value < 0.0005 ? FADE_TAU : VOLUME_TAU);
        if (ticker === null) {
          ticker = window.setInterval(tick, TICK_MS);
        }
        tick();
      } catch {
        // No audio here: the page is still there to be read.
      }
    },
    status: () => ({
      context: ctx ? ctx.state : "none",
      scene: playing?.id ?? null,
      gain: master?.gain.value ?? 0,
      nodes: playing?.graph.nodes ?? 0,
      time: ctx?.currentTime ?? 0,
      events: playing?.events ?? 0
    })
  };
};
