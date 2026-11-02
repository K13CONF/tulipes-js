/**
 * A hostname and nothing else: dot-separated labels of letters, digits and
 * inner hyphens. The nginx deploy script, run as root, writes a file named
 * after it and pastes it into the server block, so a `/`, `;`, brace or
 * newline here would be a path or a directive.
 */
export const HOSTNAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;
