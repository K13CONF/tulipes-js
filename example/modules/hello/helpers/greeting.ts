/**
 * Pure logic: no Express, no database, no framework. Trivial to unit
 * test, and the framework never scans this folder — helpers are plain
 * imports. Anything two modules need moves up to lib/.
 */
export function buildGreeting(greeting: string, name: string): string {
  return `${greeting}, ${name}!`;
}
