/**
 * Funcoes de texto puras (sem servicos do Google), testadas localmente com Node.
 */

/** "Fulano de Tal <fulano@x.com>" -> { name: 'Fulano de Tal', email: 'fulano@x.com' } */
function parseFrom_(from) {
  var s = String(from || '').trim();
  var m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) {
    var email = m[2].trim().toLowerCase();
    return { name: m[1].trim() || email, email: email };
  }
  return { name: s, email: s.toLowerCase() };
}

/**
 * Prepara o corpo do e-mail para a IA: corta o historico de respostas,
 * troca links por [link], mascara numeros longos (CPF, cartao, telefone)
 * e junta tudo em uma linha curta. So este trecho sai da sua conta.
 */
function cleanBody_(text, maxLen) {
  maxLen = maxLen || 600;
  var t = String(text || '');
  var cut = t.search(/\n\s*(>|Em .{3,120}escreveu:|On .{3,120}wrote:|-{2,}\s*(Original Message|Mensagem original)|De: .{1,120}\n\s*(Enviad[oa]|Sent):|From: .{1,120}\n\s*Sent:)/i);
  if (cut > 0) t = t.slice(0, cut);
  t = t
    .replace(/https?:\/\/\S+/gi, '[link]')
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '[cpf]')
    .replace(/\b(?:\d[ .-]?){10,19}\b/g, '[numero]')
    .replace(/[​-‍﻿͏]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length > maxLen) t = t.slice(0, maxLen - 1) + '…';
  return t;
}

/**
 * Parametro de template do WhatsApp: sem quebra de linha, sem tab,
 * sem mais de 4 espacos seguidos, nunca vazio, tamanho limitado.
 */
function sanitizeTemplateParam_(s, maxLen) {
  maxLen = maxLen || 200;
  var t = String(s === undefined || s === null ? '' : s)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
  if (!t) t = '-';
  if (t.length > maxLen) t = t.slice(0, maxLen - 1).trim() + '…';
  return t;
}

/** Texto livre de uma linha, limitado. */
function oneLine_(s, maxLen) {
  var t = String(s || '').replace(/\s+/g, ' ').trim();
  if (maxLen && t.length > maxLen) t = t.slice(0, maxLen - 1).trim() + '…';
  return t;
}

/** Dominio de um e-mail: "a@mail.gupy.io" -> "mail.gupy.io" */
function emailDomain_(email) {
  var i = String(email || '').lastIndexOf('@');
  return i >= 0 ? email.slice(i + 1).toLowerCase() : '';
}

/** true se o dominio for exatamente "base" ou um subdominio dele. */
function domainMatches_(domain, base) {
  domain = String(domain || '').toLowerCase();
  base = String(base || '').toLowerCase();
  return domain === base || domain.slice(-(base.length + 1)) === '.' + base;
}
