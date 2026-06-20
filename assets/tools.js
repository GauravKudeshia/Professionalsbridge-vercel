(function () {
  const form = document.querySelector("[data-tool-form]");
  if (!form) return;

  const fileInput = form.querySelector("[data-file-input]");
  const fileName = form.querySelector("[data-file-name]");
  const status = form.querySelector("[data-status]");
  const output = document.querySelector("[data-output]");
  const resultPanel = document.querySelector("[data-results]");
  const submit = form.querySelector("[data-submit]");

  function setStatus(message, isError) {
    status.textContent = message || "";
    status.className = isError ? "tool-error" : "tool-status";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function renderMarkdown(markdown) {
    const lines = escapeHtml(markdown).split(/\n/);
    let html = "";
    let inList = false;

    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        if (inList) {
          html += "</ul>";
          inList = false;
        }
        return;
      }

      const heading = trimmed.match(/^#{1,3}\s+(.+)$/);
      const numberedHeading = trimmed.match(/^\d+\.\s+(.+)$/);
      const bullet = trimmed.match(/^[-*]\s+(.+)$/);

      if (heading || numberedHeading) {
        if (inList) {
          html += "</ul>";
          inList = false;
        }
        html += `<h3>${(heading || numberedHeading)[1]}</h3>`;
      } else if (bullet) {
        if (!inList) {
          html += "<ul>";
          inList = true;
        }
        html += `<li>${bullet[1].replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")}</li>`;
      } else {
        if (inList) {
          html += "</ul>";
          inList = false;
        }
        html += `<p>${trimmed.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")}</p>`;
      }
    });

    if (inList) html += "</ul>";
    return html;
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || "");
        resolve({
          name: file.name,
          type: file.type || "application/octet-stream",
          data: result.split(",")[1] || result
        });
      };
      reader.onerror = () => reject(new Error("Could not read the selected file."));
      reader.readAsDataURL(file);
    });
  }

  if (fileInput) {
    fileInput.addEventListener("change", () => {
      const file = fileInput.files && fileInput.files[0];
      fileName.textContent = file ? file.name : "";
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const file = fileInput && fileInput.files ? fileInput.files[0] : null;

    setStatus("Working on your result...", false);
    submit.disabled = true;
    resultPanel.hidden = true;
    output.innerHTML = "";

    try {
      const payload = {
        tool: form.dataset.tool,
        resumeText: formData.get("resumeText") || "",
        role: formData.get("role") || "",
        company: formData.get("company") || "",
        jobDescription: formData.get("jobDescription") || ""
      };

      if (file) {
        payload.file = await readFile(file);
      }

      const response = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.error || "The tool could not complete the request.");
      }

      output.innerHTML = renderMarkdown(json.result);
      resultPanel.hidden = false;
      setStatus("Done.", false);
    } catch (error) {
      setStatus(error.message || "Something went wrong. Please try again.", true);
    } finally {
      submit.disabled = false;
    }
  });
})();
