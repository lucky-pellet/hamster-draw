import { render } from "preact";
import { App } from "./ui/app.js";
import { html } from "./ui/html.js";

const root = document.getElementById("app");
root.textContent = "";
render(html`<${App} />`, root);
