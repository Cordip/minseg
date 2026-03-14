import { build } from 'esbuild';

await build({
    entryPoints: ['src/app-bundle.js'],
    outfile: 'src/app-bundle.min.js',
    minifyWhitespace: true,
    minifySyntax: true,
});
