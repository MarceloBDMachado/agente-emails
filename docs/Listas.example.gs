/**
 * Modelo do arquivo privado Listas.gs. No editor do Apps Script, crie um arquivo
 * chamado Listas com este conteudo e troque pelos seus remetentes. Ele nao vai para o GitHub.
 * Item = endereco completo ("prof@universidade.br") ou dominio inteiro ("site-de-vagas.com").
 * Para descobrir quem entra em cada lista, rode senderReport() e veja a aba "Remetentes".
 */

// Sempre passam pela IA com a dica de remetente importante. O conteudo decide se avisa:
// "aula cancelada" avisa, "postei exercicio de revisao" nao.
var LISTA_PRIORITARIA = [
  'avisos@universidade.br',     // avisos das disciplinas
  'orientadora@universidade.br' // orientadora
];

// Descartados direto, sem gastar IA (muito volume, voce nunca abre).
var LISTA_SILENCIADA = [
  'site-de-vagas.com',
  'updates-noreply@linkedin.com'
];

// Remetentes usados por simulateSenders() para testar a IA nos seus e-mails reais.
var LISTA_TESTE = ['avisos@universidade.br'];
