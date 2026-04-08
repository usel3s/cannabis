const { FORM_DEFINITIONS } = require("../config/forms");

function getForm(formId = "teamApplication") {
  return FORM_DEFINITIONS[formId];
}

function formatApplicationPreview(form, answers) {
  const lines = [`<b>${form.title}</b>`, ""];
  for (const question of form.questions) {
    lines.push(`<b>${question.label}:</b> ${answers[question.key] || "-"}`);
  }
  return lines.join("\n");
}

module.exports = { getForm, formatApplicationPreview };
