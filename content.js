// content.js
console.log("Omni-Merchant Agent content script loaded");

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'action') {
    const { name, arguments: args } = msg;
    if (name === 'clickElement') {
      document.querySelector(args.selector)?.click();
    } else if (name === 'fillInput') {
      const el = document.querySelector(args.selector);
      if (el) { el.focus(); el.value = args.value; }
    }
  }
});
