// Generic debounce — used anywhere a rapid-fire browser event (native
// <input type="color"> dragging, a search box, etc) shouldn't fire a
// network call on every single tick. See RoleManagerModal.jsx's own
// comment for the incident this specifically fixed: some browsers fire
// `onChange` on a color input continuously while dragging the hue/
// saturation slider (once per pixel of movement, not just on release),
// which without this turned a single color drag into hundreds of PATCH
// requests in a couple of seconds — enough to trip the server's rate
// limiter and make the whole account look "stuck"/logged out.
export function debounce(fn, delayMs = 300) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  };
}
