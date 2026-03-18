import { readFileSync } from 'fs';
import { join } from 'path';
import vm from 'vm';

const jsDir = join(import.meta.dirname, '..', 'js');

/**
 * Load a browser script file into the current global scope.
 * Uses vm.runInThisContext so declarations are globally visible, matching browser behavior.
 */
export function loadScript(filename) {
    const code = readFileSync(join(jsDir, filename), 'utf-8');
    vm.runInThisContext(code, { filename });
}

/**
 * Load multiple scripts in order (simulating <script> tag loading).
 */
export function loadScripts(...filenames) {
    for (const f of filenames) {
        loadScript(f);
    }
}
