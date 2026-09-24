// Aplica o tema escolhido antes da primeira pintura, para não piscar o tema errado.
// Arquivo separado (e não script embutido) para funcionar com Content-Security-Policy script-src 'self'.
try {
  var tema = localStorage.getItem("lord-tema");
  if (tema === "claro" || tema === "escuro") document.documentElement.dataset.tema = tema;
} catch (e) {
  // navegação privada ou armazenamento bloqueado: segue o tema do sistema
}
