const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

const MAX_FILE_BYTES = 3 * 1024 * 1024;
const MAX_TEXT_CHARS = 28000;
const DEFAULT_MODELS = [
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.0-flash-lite"
];

const TOOL_CONFIG = {
  "ats-score-checker": {
    title: "ATS Score Checker",
    needsJob: false,
    prompt: ({ resumeText }) => `
You are an expert ATS resume reviewer. Analyze the resume for applicant tracking system readiness.

Return the answer in clear markdown with these exact sections:
1. ATS Score out of 100
2. Biggest Strengths
3. ATS Risks
4. Missing Keywords or Sections
5. Priority Fixes
6. Rewritten Examples

Resume:
${resumeText}`
  },
  "resume-tailor": {
    title: "Resume Tailor",
    needsJob: true,
    prompt: ({ resumeText, jobDescription, role, company }) => `
You are a truthful resume tailoring expert. Tailor the resume for this target role without inventing facts.

Return the answer in clear markdown with these exact sections:
1. Target Fit Summary
2. Keywords to Add Naturally
3. Bullet Rewrites
4. Skills Section Improvements
5. Summary/Profile Rewrite
6. What Not to Claim

Target role: ${role || "Not provided"}
Company: ${company || "Not provided"}
Job description:
${jobDescription || "Not provided"}

Resume:
${resumeText}`
  },
  "cover-letter-generator": {
    title: "Cover Letter Generator",
    needsJob: true,
    prompt: ({ resumeText, jobDescription, role, company }) => `
You are a concise cover letter writer. Create a personalized cover letter grounded only in the resume and job description.

Return the answer in clear markdown with these exact sections:
1. Cover Letter
2. Strongest Talking Points
3. Optional Short Email Version

Target role: ${role || "Not provided"}
Company: ${company || "Not provided"}
Job description:
${jobDescription || "Not provided"}

Resume:
${resumeText}`
  },
  "job-description-matcher": {
    title: "Job Description Matcher",
    needsJob: true,
    prompt: ({ resumeText, jobDescription, role, company }) => `
You are a recruiter and job-description matching analyst. Compare this resume against the target job.

Return the answer in clear markdown with these exact sections:
1. Match Score out of 100
2. Why It Matches
3. Gaps Holding the Candidate Back
4. Missing Keywords
5. Resume Changes to Improve Match
6. Interview Positioning

Target role: ${role || "Not provided"}
Company: ${company || "Not provided"}
Job description:
${jobDescription || "Not provided"}

Resume:
${resumeText}`
  },
  "interview-question-predictor": {
    title: "Interview Question Predictor",
    needsJob: false,
    prompt: ({ resumeText, jobDescription, role, company }) => `
You are an interview coach. Predict the most likely interview questions based on this resume and optional target job context.

Return the answer in clear markdown with these exact sections:
1. Likely Resume-Based Questions
2. Likely Behavioral Questions
3. Likely Technical or Role-Specific Questions
4. Strong Answer Angles
5. Weak Spots to Prepare
6. 30-Second Self-Introduction

Target role: ${role || "Not provided"}
Company: ${company || "Not provided"}
Job description:
${jobDescription || "Not provided"}

Resume:
${resumeText}`
  }
};

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function trimInput(value) {
  return String(value || "").replace(/\u0000/g, "").trim();
}

function decodeBase64(data) {
  const clean = String(data || "").replace(/^data:[^;]+;base64,/, "");
  return Buffer.from(clean, "base64");
}

async function extractFileText(file) {
  if (!file || !file.data) return "";
  const buffer = decodeBase64(file.data);
  if (buffer.length > MAX_FILE_BYTES) {
    const mb = Math.round(MAX_FILE_BYTES / 1024 / 1024);
    throw new Error(`File is too large. Please upload a file under ${mb}MB.`);
  }

  const type = String(file.type || "").toLowerCase();
  const name = String(file.name || "").toLowerCase();

  if (type.includes("pdf") || name.endsWith(".pdf")) {
    const parsed = await pdfParse(buffer);
    return trimInput(parsed.text);
  }

  if (
    type.includes("wordprocessingml") ||
    type.includes("msword") ||
    name.endsWith(".docx")
  ) {
    const parsed = await mammoth.extractRawText({ buffer });
    return trimInput(parsed.value);
  }

  if (type.includes("text") || name.endsWith(".txt")) {
    return trimInput(buffer.toString("utf8"));
  }

  throw new Error("Unsupported file type. Please upload PDF, DOCX, or TXT.");
}

function normalizeMarkdown(text) {
  return trimInput(text)
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, 16000);
}

function getModelCandidates() {
  const configured = [
    process.env.GEMINI_MODEL,
    process.env.GEMINI_FALLBACK_MODELS
  ]
    .filter(Boolean)
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .filter(Boolean);

  return Array.from(new Set([...configured, ...DEFAULT_MODELS]));
}

function isTemporaryModelError(message) {
  return /high demand|overloaded|temporar|unavailable|try again later|503/i.test(
    message
  );
}

async function generateWithModel(apiKey, model, prompt) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.35,
          topP: 0.9,
          maxOutputTokens: 4096
        }
      })
    }
  );

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      json.error && json.error.message
        ? json.error.message
        : "Gemini request failed.";
    if (/quota|rate limit|exceeded/i.test(message)) {
      throw new Error(
        "The AI service reached its current Gemini quota. Please try again shortly, or check the Gemini API key project's quota and billing settings in Google AI Studio."
      );
    }
    throw new Error(message);
  }

  const text =
    json.candidates &&
    json.candidates[0] &&
    json.candidates[0].content &&
    json.candidates[0].content.parts
      ? json.candidates[0].content.parts.map((part) => part.text || "").join("\n")
      : "";

  if (!text.trim()) {
    throw new Error("Gemini returned an empty response.");
  }

  return normalizeMarkdown(text);
}

async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured in Vercel.");
  }

  const models = getModelCandidates();
  let lastError;

  for (const model of models) {
    try {
      return await generateWithModel(apiKey, model, prompt);
    } catch (error) {
      lastError = error;
      if (!isTemporaryModelError(error.message || "")) {
        throw error;
      }
    }
  }

  throw new Error(
    lastError && lastError.message
      ? `${lastError.message} Please try again in a few minutes.`
      : "The AI service is temporarily unavailable. Please try again in a few minutes."
  );
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  try {
    const body = req.body || {};
    const tool = trimInput(body.tool);
    const config = TOOL_CONFIG[tool];
    if (!config) {
      return sendJson(res, 400, { error: "Unknown tool." });
    }

    const pastedText = trimInput(body.resumeText);
    const fileText = await extractFileText(body.file);
    const resumeText = trimInput(`${fileText}\n\n${pastedText}`).slice(
      0,
      MAX_TEXT_CHARS
    );
    const jobDescription = trimInput(body.jobDescription).slice(0, 16000);
    const role = trimInput(body.role).slice(0, 160);
    const company = trimInput(body.company).slice(0, 160);

    if (!resumeText) {
      return sendJson(res, 400, {
        error: "Please upload a resume or paste your resume text."
      });
    }

    if (config.needsJob && !jobDescription) {
      return sendJson(res, 400, {
        error: "Please paste the target job description for this tool."
      });
    }

    const result = await callGemini(
      config.prompt({ resumeText, jobDescription, role, company })
    );

    return sendJson(res, 200, {
      tool: config.title,
      result
    });
  } catch (error) {
    return sendJson(res, 500, {
      error: error.message || "Something went wrong. Please try again."
    });
  }
};
