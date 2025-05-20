# About
This will find usages of a string within a codebase and will attempt to find the Codeowner
of the file that contains the string.

# Usage
```
bun run src/usages.ts -r <repo directory> -q <string>> --codeowners .github/CODEOWNERS -o <output directory>>
```