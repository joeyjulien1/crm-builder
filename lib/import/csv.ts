/**
 * A small RFC 4180 parser. Quoted fields, escaped quotes, embedded newlines and
 * commas. Enough for the spreadsheets people actually export, without adding a
 * dependency for it.
 */
export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

export function parseCsv(input: string, delimiter = ","): ParsedCsv {
  const text = input.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let index = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // A trailing newline should not produce a row of one empty string.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  while (index < text.length) {
    const char = text[index]!;

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index++;
        continue;
      }
      field += char;
      index++;
      continue;
    }

    if (char === '"') {
      quoted = true;
      index++;
      continue;
    }
    if (char === delimiter) {
      endField();
      index++;
      continue;
    }
    if (char === "\r") {
      index++;
      continue;
    }
    if (char === "\n") {
      endRow();
      index++;
      continue;
    }

    field += char;
    index++;
  }

  if (field !== "" || row.length > 0) endRow();

  const headers = (rows.shift() ?? []).map((header) => header.trim());
  return { headers, rows };
}

/** Picks the delimiter a file actually uses — exports are not always commas. */
export function detectDelimiter(sample: string): string {
  const firstLine = sample.split("\n")[0] ?? "";
  const counts = [",", ";", "\t"].map((candidate) => ({
    candidate,
    count: firstLine.split(candidate).length - 1,
  }));
  return counts.sort((a, b) => b.count - a.count)[0]?.candidate ?? ",";
}
