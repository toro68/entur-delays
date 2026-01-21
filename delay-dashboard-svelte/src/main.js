import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";
import { devSwCleanup } from "./utils/sw-cleanup";

devSwCleanup();

const app = mount(App, {
  target: document.getElementById("sa-entur-delays"),
});

export default app;
