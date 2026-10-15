"use strict";
function authorize(event, roles, targets) {
  const target = targets.find((t) => t.sender === event.sender);
  if (
    !target ||
    !roles.includes(target.role) ||
    event.senderFrame !== event.sender.mainFrame ||
    event.senderFrame?.url !== target.url
  )
    throw new Error("Access denied");
}
module.exports = { authorize };
