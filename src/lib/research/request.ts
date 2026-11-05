/** Open the shared assistant with a user-reviewed research question. */
export function requestResearch(prompt: string) {
  window.dispatchEvent(new CustomEvent("fu:research-request", { detail: prompt }));
}