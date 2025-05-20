import minimist from "minimist";
import ignore from "ignore";
import path from "path";
import fs from "fs/promises";
import { minimatch } from "minimatch";

const argv = minimist(process.argv.slice(2), {
  string: ["root", "codeowners", "query", "out"],
  alias: { root: "r", codeowners: "c", query: "q", out: "o" },
  default: { out: "results" }
});

async function walk(
  dir: string,
  ig: ignore.Ignore,
  base = dir
): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results: string[] = [];

  for (const ent of entries) {
    const fullPath = path.join(dir, ent.name);
    // compute a relative path from the base so .gitignore patterns align
    const relPath = path.relative(base, fullPath) || ent.name;

    // skip if git folder or matches any .gitignore pattern
    if (relPath === ".git" || ig.ignores(relPath)) continue;

    if (ent.isDirectory()) {
      results.push(...(await walk(fullPath, ig, base)));
    } else if (ent.isFile()) {
      results.push(relPath);
    }
  }

  return results;
}

async function getUsages() {
  const sourceDir = argv.root;
  const gitignoreContent = await fs
    .readFile(path.resolve(".gitignore"), "utf-8")
    .catch(() => "");
  const ig = ignore();
  ig.add(gitignoreContent);
  // also explicitly ignore the .git folder
  ig.add(".git");
  // ignore things in the lib folder that we dont care about
  ig.add("**/*/lib/*");
  // ignore binary files
  ig.add([
    "**/*.png",
    "**/*.jpg",
    "**/*.jpeg",
    "**/*.gif",
    "**/*.svg",
    "**/*.webp",
    "**/*.ico",
    "**/*.zip",
    "**/*.tar",
    "**/*.gz",
    "**/*.bz2",
    "**/*.xz",
    "**/*.tgz"
  ]);

  return walk(sourceDir, ig).then(async (files) => {
    console.log(`Found ${files.length} files in ${sourceDir}`);

    // map file → list of line numbers where query was found
    const found: Record<string, number[]> = {};

    for (const file of files) {
      const filePath = path.join(sourceDir, file);
      const fileContent = await fs.readFile(filePath, "utf-8");

      const lines = fileContent.split(/\r?\n/);
      const hits: number[] = [];

      lines.forEach((line, idx) => {
        if (line.includes(argv.query)) {
          // line numbers are 1-based
          hits.push(idx + 1);
        }
      });

      if (hits.length) {
        found[file] = hits;
      }
    }

    return found;
  });

}

const getOwners = async (usages: Record<string, number[]>) => {
  const codeownersPath = path.join(argv.root, argv.codeowners);
  const codeownersContent = await fs.readFile(codeownersPath, "utf-8");
  const coMap = new Map<string, string[]>();
  codeownersContent
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"))
    .forEach((line) => {
      const parts = line.split(/\s+/);
      const pattern = parts[0].slice(1);
      const owners = parts.slice(1);
      coMap.set(pattern, owners);
    });

  // Accumulate counts and file lists per owner
  const ownerCounts = new Map<string, number>();
  const ownerFiles = new Map<string, { file:string, lines: number[] }[]>();

  let i = 0;
  for (const [file, lines] of Object.entries(usages)) {
    for (const [pattern, owners] of coMap.entries()) {
      // console.log("Checking pattern:", file, pattern);
      if (minimatch(file, pattern)) {
        for (const owner of owners) {
          // Increment count
          ownerCounts.set(owner, (ownerCounts.get(owner) || 0) + 1);

          // Add file to list
          if (!ownerFiles.has(owner)) {
            ownerFiles.set(owner, []);
          }
          ownerFiles.get(owner)?.push({file, lines});
        }
      }
    }
  }

  console.log(`Found ${ownerCounts.size} owners with files.`);

  const outDir = path.resolve(argv.out);
  // Ensure output directory exists
  await fs.mkdir(outDir, { recursive: true });

  // Write summary CSV with counts
  const resultsLines = [
    "owner,count",
    ...Array.from(ownerCounts.entries()).map(
      ([owner, count]) => `${owner},${count}`
    )
  ];
  await fs.writeFile(path.join(outDir, "results.csv"), resultsLines.join("\n"));

  // Write individual owner CSVs with file paths
  for (const [owner, fileAndLines] of ownerFiles.entries()) {
    const safeName = owner.replace(/[^a-zA-Z0-9_-]/g, "_");
    const lines = ["file,lines"]
        .concat(
            fileAndLines.map(({file, lines}) => {
            const lineNumbers = `"${lines.join(", ")}"`;
            return `${file},${lineNumbers}`;
            })
        );

    await fs.writeFile(path.join(outDir, `${safeName}.csv`), lines.join("\n"));
  }

  console.log(`Results written to ${outDir}`);
};

const main = async () => {
  const usages = await getUsages();
  void getOwners(usages);
};
void main();
