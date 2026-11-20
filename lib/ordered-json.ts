// JSON tree that keeps key order and the original text of every primitive.
// JSON.parse reorders integer-like keys (WING snaps have {"sdlink":…, "1":…}), so a
// parse → stringify round trip is not byte-identical. This one is: untouched parts of the
// snapshot are written back exactly as WING Edit produced them.

export type JNode =
  | { k: "obj"; e: [string, JNode][] }
  | { k: "arr"; a: JNode[] }
  | { k: "raw"; t: string }; // primitive token, verbatim

export function parseOrdered(text: string): JNode {
  let i = 0;
  const ws = () => {
    while (i < text.length && " \t\n\r".includes(text[i])) i++;
  };
  const fail = (msg: string): never => {
    throw new SyntaxError(`${msg} at offset ${i}`);
  };
  const str = (): string => {
    const start = i++;
    while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
    if (i >= text.length) fail("Unterminated string");
    i++;
    return text.slice(start, i);
  };
  const value = (): JNode => {
    ws();
    const c = text[i];
    if (c === "{") {
      i++;
      const e: [string, JNode][] = [];
      ws();
      if (text[i] === "}") return i++, { k: "obj", e };
      for (;;) {
        ws();
        if (text[i] !== '"') fail("Expected key");
        const key = JSON.parse(str()) as string;
        ws();
        if (text[i++] !== ":") fail("Expected ':'");
        e.push([key, value()]);
        ws();
        if (text[i] === ",") i++;
        else if (text[i] === "}") return i++, { k: "obj", e };
        else fail("Expected ',' or '}'");
      }
    }
    if (c === "[") {
      i++;
      const a: JNode[] = [];
      ws();
      if (text[i] === "]") return i++, { k: "arr", a };
      for (;;) {
        a.push(value());
        ws();
        if (text[i] === ",") i++;
        else if (text[i] === "]") return i++, { k: "arr", a };
        else fail("Expected ',' or ']'");
      }
    }
    if (c === '"') return { k: "raw", t: str() };
    const m = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i, i + 40));
    if (!m) fail("Unexpected token");
    i += m![0].length;
    return { k: "raw", t: m![0] };
  };
  const root = value();
  ws();
  if (i !== text.length) fail("Trailing data");
  return root;
}

export function serialize(n: JNode): string {
  if (n.k === "raw") return n.t;
  if (n.k === "arr") return `[${n.a.map(serialize).join(",")}]`;
  return `{${n.e.map(([k, v]) => `${JSON.stringify(k)}:${serialize(v)}`).join(",")}}`;
}

export const fromValue = (v: unknown): JNode => parseOrdered(JSON.stringify(v));
export const toValue = (n: JNode): unknown => JSON.parse(serialize(n));

export function getNode(root: JNode, path: string[]): JNode | undefined {
  let n: JNode | undefined = root;
  for (const p of path) {
    if (n?.k === "obj") n = n.e.find(([k]) => k === p)?.[1];
    else if (n?.k === "arr") n = n.a[Number(p)];
    else return undefined;
  }
  return n;
}

// Replace an existing node in place (keeps its position). Never creates new keys.
export function replaceNode(root: JNode, path: string[], node: JNode) {
  const parent = getNode(root, path.slice(0, -1));
  const last = path[path.length - 1];
  if (parent?.k === "obj") {
    const entry = parent.e.find(([k]) => k === last);
    if (entry) return void (entry[1] = node);
  } else if (parent?.k === "arr" && Number(last) < parent.a.length) {
    return void (parent.a[Number(last)] = node);
  }
  throw new Error(`Path not in baseline: /${path.join("/")}`);
}

export function cloneNode(n: JNode): JNode {
  if (n.k === "raw") return { k: "raw", t: n.t };
  if (n.k === "arr") return { k: "arr", a: n.a.map(cloneNode) };
  return { k: "obj", e: n.e.map(([k, v]) => [k, cloneNode(v)]) };
}
