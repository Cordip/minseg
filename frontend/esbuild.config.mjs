import { build } from 'esbuild';

await build({
    entryPoints: ['src/app.js'],
    outfile: 'src/app-bundle.js',
    bundle: true,
    minifyWhitespace: true,
    minifySyntax: true,
    format: 'iife',
    define: {
        'process.env.NODE_ENV': '"production"',
    },
    alias: {
        'react': './src/shims/react.js',
        'react-dom': './src/shims/react-dom.js',
    },
});
