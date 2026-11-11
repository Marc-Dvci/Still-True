import { runDrill } from "./api";
import { renderScenarioPicker } from "./drill-ui";

const list = document.getElementById("scenarios") as HTMLElement;
const result = document.getElementById("result") as HTMLElement;
await renderScenarioPicker(list, result, runDrill).catch(() => {
  result.textContent = "The fire drill could not load. Please try again.";
});
