const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const tools = [
  "/tools/ats-score-checker/",
  "/tools/resume-tailor/",
  "/tools/cover-letter-generator/",
  "/tools/job-description-matcher/",
  "/tools/interview-question-predictor/"
];
const forbiddenReferenceHost = String.fromCharCode(
  104, 116, 116, 112, 115, 58, 47, 47, 115, 99, 97, 108, 101, 46, 106, 111, 98, 115, 47
);

const htmlFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    if (entry.isFile() && entry.name.endsWith(".html")) htmlFiles.push(full);
  }
}

walk(root);

for (const route of tools) {
  const file = path.join(root, route, "index.html");
  if (!fs.existsSync(file)) {
    throw new Error(`Missing tool page: ${route}`);
  }
}

let dropdownPages = 0;
for (const file of htmlFiles) {
  const text = fs.readFileSync(file, "utf8");
  if (text.includes("career-boosters-dropdown")) {
    dropdownPages += 1;
    for (const route of tools) {
      if (!text.includes(`href="${route}"`)) {
        throw new Error(`Missing ${route} in ${file}`);
      }
    }
    if (text.includes(forbiddenReferenceHost)) {
      throw new Error(`External reference link still present in ${file}`);
    }
  }
}

if (dropdownPages !== 32) {
  throw new Error(`Expected 32 dropdown pages, found ${dropdownPages}`);
}

console.log(`OK: ${htmlFiles.length} HTML files, ${dropdownPages} dropdown pages, ${tools.length} tools.`);
