import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * React's rules of hooks, checked over the whole app: the repo has no ESLint,
 * and a hook after an early return passes the type check and every test that
 * renders once, then takes the app down on the second render ("Rendered more
 * hooks than during the previous render", React error 310). It did, opening a
 * reader's card (e025932).
 *
 * A plain reading of each file, not ESLint's full rule: a hook is a call named
 * `use…` (or `x.use…`); a component or hook is a function named in PascalCase or
 * `use…`. Flagged: a hook after a statement that can return, a hook under a
 * condition, a loop, `&&`, `||`, `??` or `?:`, a hook in any other function
 * (a callback, a helper), and a component of the same file called as a plain
 * function.
 */

const isHook = (name: string) => /^use[A-Z0-9]/.test(name);
/** PascalCase: `ReaderCard`, not a constant such as `KEY`. */
const isComponentName = (name: string) => /^[A-Z][A-Z0-9]*[a-z]/.test(name);
const isComponentOrHook = (name: string | null) => Boolean(name && (isComponentName(name) || isHook(name)));
type Fn = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;
const isFn = (node: ts.Node): node is Fn =>
  ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node);

const hookName = (call: ts.CallExpression) => {
  const callee = call.expression;
  const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
  return name && isHook(name) ? name : null;
};

/** A function's own name, or the variable it is given to (also through `memo(…)` / `forwardRef(…)`). */
const nameOf = (fn: Fn): string | null => {
  if (fn.name && ts.isIdentifier(fn.name)) return fn.name.text;
  let parent = fn.parent;
  while (parent && ts.isCallExpression(parent)) parent = parent.parent;
  return parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name) ? parent.name.text : null;
};

/** Hook calls under `node`, not counting those in functions nested inside it. */
const hooksIn = (node: ts.Node) => {
  const found: ts.CallExpression[] = [];
  const visit = (child: ts.Node) => {
    if (child !== node && isFn(child)) return;
    if (ts.isCallExpression(child) && hookName(child)) found.push(child);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
};

const canReturn = (statement: ts.Statement) => {
  let found = false;
  const visit = (node: ts.Node) => {
    if (found || isFn(node)) return;
    if (ts.isReturnStatement(node) || ts.isThrowStatement(node)) found = true;
    else ts.forEachChild(node, visit);
  };
  visit(statement);
  return found;
};

const LOGICAL = new Set([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken]);

export const hookProblems = (file: string, text: string): string[] => {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const problems: string[] = [];
  const report = (node: ts.Node, message: string) =>
    problems.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${message}`);

  const conditional = (body: ts.Node, owner: string) => {
    const visit = (node: ts.Node, under: boolean) => {
      if (node !== body && isFn(node)) return;
      if (ts.isCallExpression(node) && under && hookName(node)) report(node, `${owner}: ${hookName(node)} called conditionally or in a loop`);
      if (ts.isIfStatement(node)) {
        visit(node.expression, under);
        visit(node.thenStatement, true);
        if (node.elseStatement) visit(node.elseStatement, true);
      } else if (ts.isConditionalExpression(node)) {
        visit(node.condition, under);
        visit(node.whenTrue, true);
        visit(node.whenFalse, true);
      } else if (ts.isBinaryExpression(node) && LOGICAL.has(node.operatorToken.kind)) {
        visit(node.left, under);
        visit(node.right, true);
      } else if (ts.isIterationStatement(node, false) || ts.isSwitchStatement(node) || ts.isTryStatement(node)) {
        ts.forEachChild(node, (child) => visit(child, true));
      } else {
        ts.forEachChild(node, (child) => visit(child, under));
      }
    };
    visit(body, false);
  };

  const components = new Set<string>();
  const visit = (node: ts.Node) => {
    if (isFn(node) && node.body) {
      const name = nameOf(node);
      if (isComponentOrHook(name)) {
        if (isComponentName(name!)) components.add(name!);
        conditional(node.body, name!);
        if (ts.isBlock(node.body)) {
          let returned = false;
          for (const statement of node.body.statements) {
            if (returned) for (const call of hooksIn(statement)) report(call, `${name}: ${hookName(call)} after an early return`);
            if (!ts.isReturnStatement(statement) && canReturn(statement)) returned = true;
          }
        }
      } else {
        for (const call of hooksIn(node.body)) report(call, `${hookName(call)} inside ${name ? `${name}()` : "a callback"}, which is not a component or a hook`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const calls = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && components.has(node.expression.text)) {
      report(node, `the component ${node.expression.text} called as a plain function (its hooks land in the caller)`);
    }
    ts.forEachChild(node, calls);
  };
  calls(source);
  return problems;
};

const sources = import.meta.glob(["../**/*.{ts,tsx}", "!../**/*.test.{ts,tsx}", "!../**/*.d.ts"], {
  query: "?raw",
  import: "default",
  eager: true
}) as Record<string, string>;

describe("the rules of hooks", () => {
  it("are kept everywhere in the app", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(300);
    const problems = Object.entries(sources).flatMap(([file, text]) => hookProblems(file.replace(/^\.\.\//, ""), text));
    expect(problems).toEqual([]);
    // Parsing every file takes seconds, more while the rest of the suite runs.
  }, 60_000);

  it("are checked: each way of breaking them is found", () => {
    const broken = `
      export const Early = ({ open }) => {
        if (!open) return null;
        const [a] = useState(0);
        return a;
      };
      export const Guarded = ({ on }) => {
        const b = on && useStore((s) => s.b);
        const c = on ? useMemo(() => 1, []) : 0;
        for (const x of [1]) useEffect(() => undefined);
        return b + c;
      };
      const helper = () => useRef(null);
      export const Effects = () => {
        useEffect(() => { useState(1); }, []);
        return <div>{Early({ open: true })}</div>;
      };
      export const Fine = ({ open }) => {
        const [d] = useState(0);
        const store = useCommunityStore.getState();
        if (!open) return null;
        return d;
      };
    `;
    const found = hookProblems("broken.tsx", broken).map((line) => line.replace(/^broken\.tsx:\d+: /, ""));
    expect(found).toEqual([
      "Early: useState after an early return",
      "Guarded: useStore called conditionally or in a loop",
      "Guarded: useMemo called conditionally or in a loop",
      "Guarded: useEffect called conditionally or in a loop",
      "useRef inside helper(), which is not a component or a hook",
      "useState inside a callback, which is not a component or a hook",
      "the component Early called as a plain function (its hooks land in the caller)"
    ]);
  });
});
