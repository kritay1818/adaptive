const { contextBridge, ipcRenderer } = require("electron");
const call = (name, arg) =>
  ipcRenderer.invoke("adactive:" + name, arg).then((result) => {
    if (!result.ok) throw new Error(result.error);
    return result.value;
  });
contextBridge.exposeInMainWorld(
  "adactive",
  Object.freeze({
    state: (id) => call("state", id),
    create: (name) => call("create", name),
    save: (fields) => call("save", fields),
    connect: (fields) => call("connect", fields),
    discoverModels: (fields) => call("discoverModels", fields),
    cancelModels: () => call("cancelModels"),
    selectModel: (fields) => call("selectModel", fields),
    modelState: () => call("modelState"),
    closeModel: () => call("closeModel"),
    openKeyPage: (provider) => call("openKeyPage", provider),
    onModelReset: (callback) => {
      const listener = () => callback();
      ipcRenderer.on("adactive:modelReset", listener);
      return () => ipcRenderer.removeListener("adactive:modelReset", listener);
    },
    openModel: () => call("openModel"),
    openHistory: () => call("openHistory"),
    historyState: () => call("historyState"),
    closeHistory: () => call("closeHistory"),
    wpActivityLog: () => call("wpActivityLog"),
    undoWordPress: (fields) => call("undoWordPress", fields),
    undoWordPressPlan: (planId) => call("undoWordPressPlan", { planId }),
    unblockWordPress: () => call("unblockWordPress"),
    messageAction: (fields) => call("messageAction", fields),
    onAttached: (callback) => {
      const listener = (_e, value) => callback(value);
      ipcRenderer.on("adactive:attached", listener);
      return () => ipcRenderer.removeListener("adactive:attached", listener);
    },
    onStateChanged: (callback) => {
      const listener = () => callback();
      ipcRenderer.on("adactive:stateChanged", listener);
      return () =>
        ipcRenderer.removeListener("adactive:stateChanged", listener);
    },
    openWordPress: () => call("openWordPress"),
    wordPressState: () => call("wordPressState"),
    testWordPress: (fields) => call("testWordPress", fields),
    exportDiagnostics: () => call("exportDiagnostics"),
    openPasswordPage: (site) => call("openPasswordPage", { site }),
    closeWordPress: () => call("closeWordPress"),
    onWordPressReset: (callback) => {
      const listener = () => callback();
      ipcRenderer.on("adactive:wordPressReset", listener);
      return () =>
        ipcRenderer.removeListener("adactive:wordPressReset", listener);
    },
    connectWordPress: (fields) => call("connectWordPress", fields),
    disconnectWordPress: (id) => call("disconnectWordPress", id),
    disconnect: () => call("disconnect"),
    send: (fields) => call("send", fields),
    decideWordPress: (fields) => call("decideWordPress", fields),
    cancelWordPress: () => call("cancelWordPress"),
    pickFiles: () => call("pickFiles"),
    dropFile: (id) => call("dropFile", { id }),
    openHelp: (target) => call("openHelp", { target }),
    resumeAction: (action) => call("resumeAction", { action }),
    openSite: (operation) => call("openSite", { operation }),
    onProgress: (callback) => {
      const listener = (_e, value) => callback(value);
      ipcRenderer.on("adactive:progress", listener);
      return () => ipcRenderer.removeListener("adactive:progress", listener);
    },
    chatSurface: (surface) => call("chatSurface", surface),
    onShow: (callback) => {
      const listener = () => callback();
      ipcRenderer.on("adactive:focusComposer", listener);
      return () =>
        ipcRenderer.removeListener("adactive:focusComposer", listener);
    },
    show: () => call("show"),
    hide: () => call("hide"),
    hidePet: () => call("hidePet"),
    resizePet: (width) => call("resizePet", width),
    movePet: (position) => call("movePet", position),
  }),
);
