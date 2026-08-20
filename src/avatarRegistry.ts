import fs from 'node:fs';

// registry.tsv: filename\talias1\talias2... (no header, sorted by filename)
// alias1 = Chinese name, alias2 = id, alias3 = English name (if any)
export const loadAvatarRegistry = (): Map<string, string[]> => new Map(
  fs.readFileSync('registry.tsv', 'utf8').trimEnd().split(/\r?\n/)
    .map(line => {
      const [filename, ...aliases] = line.split('\t');
      if (!filename || !aliases.length) throw new Error(`Bad registry.tsv row: ${line}`);
      return [filename, aliases];
    }),
);
