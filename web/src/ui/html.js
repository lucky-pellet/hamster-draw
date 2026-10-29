// JSX-like templates without a build step. Preact escapes every interpolated string.
import { h } from "preact";
import htm from "htm";

export const html = htm.bind(h);
