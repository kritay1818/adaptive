"use strict";
// Completed message content only. Never connection records, context/rules or paths.
function selectedMessages(project, { projectId, messageIds } = {}) {
 if (projectId !== project.id || !Array.isArray(messageIds) || !messageIds.length || messageIds.length > 20 || new Set(messageIds).size !== messageIds.length) throw Error('בחירת הודעות אינה תקינה');
 const messages = messageIds.map(id => {
  if(typeof id !== 'string' || id.length > 100) throw Error('מזהה הודעה אינו תקין');
  const m = project.messages.find(m => m.id === id);
  if(!m || !['user','assistant'].includes(m.role) || typeof m.content !== 'string') throw Error('ההודעה אינה בפרויקט הנוכחי');
  return { id:m.id, role:m.role, content:m.content, at:m.at };
 });
 if(messages.reduce((n,m)=>n+m.content.length,0) > 200000) throw Error('הבחירה ארוכה מדי');
 return messages;
}
function formatMessages(messages, format) {
 if(!['md','txt'].includes(format)) throw Error('פורמט אינו נתמך');
 return messages.map(m => `${format === 'md' ? '## ' : ''}${m.role === 'user' ? 'את/ה' : 'ADActive'} · ${m.at}\n${m.content}`).join('\n\n');
}
module.exports = { selectedMessages, formatMessages };
