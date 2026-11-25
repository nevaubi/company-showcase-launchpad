// Reads an EX-102 asset data file as a stream: one record at a time, never the whole document.
// An auto loan file is 30 to 220 MB; a commercial mortgage file is under 1 MB. The same reader does both.
//
// Shape of every EX-102 (checked against real files, see xml.test.ts):
//   <assetData xmlns="http://www.sec.gov/edgar/document/absee/<class>/assetdata">
//     <assets> <field>text</field> ... <property> <field>text</field> ... </property> ... </assets>
//     ...
//   </assetData>
// A record is one child of the root. Its children are fields (text only) or blocks (children that are
// fields). Anything else (deeper nesting, text beside child elements) stops the read with an error:
// a file this reader does not understand is refused, not half read.
import { SaxesParser, type SaxesTagNS } from "saxes";

export type AbsField = [name: string, text: string];
export type AbsBlock = { name: string; fields: AbsField[] };
export type AbsRecord = {
  /** position in the file, from 1 */
  rec: number;
  /** element name of the record (always `assets` in the files seen) */
  tag: string;
  fields: AbsField[];
  blocks: AbsBlock[];
};

export type AbsFamily = "cmbs" | "auto_loan" | "auto_lease" | "other";

export type AbsFileShape = {
  root: string;
  namespace: string;
  family: AbsFamily;
  records: number;
  /** record element names and how many of each */
  tags: Record<string, number>;
  /** attributes other than namespace declarations: the files seen carry none, so any is counted */
  attributes: number;
};

const NS = /^http:\/\/www\.sec\.gov\/edgar\/document\/absee\/([a-z]+)\/assetdata$/;

/** The asset class an EX-102 states through its namespace. */
export function familyOf(namespace: string): AbsFamily {
  const cls = NS.exec(namespace)?.[1];
  return cls === "cmbs"
    ? "cmbs"
    : cls === "autoloan"
      ? "auto_loan"
      : cls === "autolease"
        ? "auto_lease"
        : "other";
}

export class AbsXmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AbsXmlError";
  }
}

/**
 * A push reader: `write` decoded text in any chunking, then `close`. `onRecord` is called once per
 * record, in file order, as soon as its end tag has been read.
 */
export function createAbsReader(onRecord: (record: AbsRecord) => void) {
  const parser = new SaxesParser({ xmlns: true });
  const shape: AbsFileShape = {
    root: "",
    namespace: "",
    family: "other",
    records: 0,
    tags: {},
    attributes: 0,
  };
  let depth = 0;
  let record: AbsRecord | null = null;
  // the open child of a record (depth 3) and, inside a block, the open field (depth 4)
  let child: { name: string; text: string; fields: AbsField[]; block: boolean } | null = null;
  let leaf: { name: string; text: string } | null = null;
  let failure: AbsXmlError | null = null;
  const fail = (message: string) => {
    failure ??= new AbsXmlError(message);
  };

  parser.on("error", (e) => fail(`not well-formed XML: ${e.message}`));
  parser.on("opentag", (tag: SaxesTagNS) => {
    depth++;
    for (const a of Object.values(tag.attributes))
      if (a.prefix !== "xmlns" && a.name !== "xmlns") shape.attributes++;
    if (depth === 1) {
      shape.root = tag.local;
      shape.namespace = tag.uri;
      shape.family = familyOf(tag.uri);
    } else if (depth === 2) {
      record = { rec: shape.records + 1, tag: tag.local, fields: [], blocks: [] };
    } else if (depth === 3) {
      child = { name: tag.local, text: "", fields: [], block: false };
    } else if (depth === 4 && child) {
      if (!child.block && child.text.trim())
        fail(`record ${record?.rec}: <${child.name}> holds both text and elements`);
      child.block = true;
      leaf = { name: tag.local, text: "" };
    } else {
      fail(`record ${record?.rec}: <${tag.local}> is nested deeper than a block's fields`);
    }
  });
  const text = (t: string) => {
    if (leaf) leaf.text += t;
    else if (child) {
      if (child.block) {
        if (t.trim()) fail(`record ${record?.rec}: <${child.name}> holds both text and elements`);
      } else child.text += t;
    } else if (t.trim()) fail(`text outside a field${record ? ` in record ${record.rec}` : ""}`);
  };
  parser.on("text", text);
  parser.on("cdata", text);
  parser.on("closetag", () => {
    if (depth === 4 && child && leaf) {
      child.fields.push([leaf.name, leaf.text]);
      leaf = null;
    } else if (depth === 3 && record && child) {
      if (child.block) record.blocks.push({ name: child.name, fields: child.fields });
      else record.fields.push([child.name, child.text]);
      child = null;
    } else if (depth === 2 && record) {
      shape.records++;
      shape.tags[record.tag] = (shape.tags[record.tag] ?? 0) + 1;
      const done = record;
      record = null;
      if (!failure) onRecord(done);
    }
    depth--;
  });

  return {
    /** What has been read so far; the root's namespace and family are known once the first record arrives. */
    shape: (): AbsFileShape => shape,
    write(chunk: string) {
      if (failure) throw failure;
      parser.write(chunk);
      if (failure) throw failure;
    },
    /** Ends the document and returns what it was. Throws when the document is cut off or is not an asset data file. */
    close(): AbsFileShape {
      if (!failure) parser.close();
      if (failure) throw failure;
      if (shape.root !== "assetData")
        throw new AbsXmlError(`root element is <${shape.root || "?"}>, not <assetData>`);
      return shape;
    },
  };
}

/** The encoding an XML document declares in its first bytes (utf-8 when it declares none). */
export function declaredEncoding(head: Uint8Array): string {
  let ascii = "";
  for (let i = 0; i < Math.min(head.length, 200); i++) ascii += String.fromCharCode(head[i]);
  return (
    /<\?xml[^>]*\bencoding\s*=\s*["']([A-Za-z0-9._-]+)["']/.exec(ascii)?.[1].toLowerCase() ??
    "utf-8"
  );
}

/** Reads a whole document held in memory (tests, small files). */
export function readAbsText(xml: string): { shape: AbsFileShape; records: AbsRecord[] } {
  const records: AbsRecord[] = [];
  const reader = createAbsReader((r) => records.push(r));
  reader.write(xml);
  return { shape: reader.close(), records };
}
