const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const MarkdownIt = require('markdown-it');
const heicConvert = require('heic-convert');

// Paths
const CONTENT_DIR = path.join(__dirname, 'content');
const TEMPLATES_DIR = path.join(__dirname, 'templates');
const STATIC_DIR = path.join(__dirname, 'static');
const DIST_DIR = path.join(__dirname, 'dist');

const md = new MarkdownIt({ html: true });

// Section division around ## headings
let sectionOpen = false;
md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
	const token = tokens[idx];
	if (token.tag === 'h2') {
		return `</section>\n<section>\n${self.renderToken(tokens, idx, options)}`;
	}
	return self.renderToken(tokens, idx, options);
};

// Process shortcodes (supporting links, citations, figures)
function processShortcodes(rawMarkdown) {
	let snCount = 0;
	let mnCount = 0;
	let mfCount = 0;

	return rawMarkdown
		.replace(/\[sn:\s*((?:\[[^\]]*\]\([^\)]*\)|[^\]])+)\]/g, (_, text) => {
			snCount++;
			const id = `sn-${snCount}`;
			return `<label for="${id}" class="margin-toggle sidenote-number"></label><input type="checkbox" id="${id}" class="margin-toggle"/><span class="sidenote">${md.renderInline(text)}</span>`;
		})
		.replace(/\[mn:\s*((?:\[[^\]]*\]\([^\)]*\)|[^\]])+)\]/g, (_, text) => {
			mnCount++;
			const id = `mn-${mnCount}`;
			return `<label for="${id}" class="margin-toggle">&#8853;</label><input type="checkbox" id="${id}" class="margin-toggle"/><span class="marginnote">${md.renderInline(text)}</span>`;
		})
		.replace(/\[mf:\s*([^|\]]+)\s*\|\s*([^\]]+)\]/g, (_, src, caption) => {
			mfCount++;
			const id = `mf-${mfCount}`;
			const cleanSrc = src.trim();
			const cleanCap = caption.trim();
			return `<label for="${id}" class="margin-toggle">&#8853;</label><input type="checkbox" id="${id}" class="margin-toggle"/><span class="marginnote"><img src="${cleanSrc}" alt="${cleanCap}"/>${md.renderInline(cleanCap)}</span>`;
		});
}

// Asynchronously copy static files and convert HEIC -> JPG
async function copyAndConvertAssets(srcDir, destDir) {
	if (!fs.existsSync(srcDir)) return;
	fs.mkdirSync(destDir, { recursive: true });

	const entries = fs.readdirSync(srcDir, { withFileTypes: true });

	for (const entry of entries) {
		const srcPath = path.join(srcDir, entry.name);
		const destPath = path.join(destDir, entry.name);

		if (entry.isDirectory()) {
			await copyAndConvertAssets(srcPath, destPath);
		} else if (/\.heic$/i.test(entry.name)) {
			// Convert HEIC -> JPG using heic-convert
			const jpgName = entry.name.replace(/\.heic$/i, '.jpg');
			const targetPath = path.join(destDir, jpgName);

			try {
				const inputBuffer = fs.readFileSync(srcPath);
				const outputBuffer = await heicConvert({
					buffer: inputBuffer, // the HEIC file buffer
					format: 'JPEG',      // output format
					quality: 0.85        // the jpeg compression quality, between 0 and 1
				});

				fs.writeFileSync(targetPath, outputBuffer);
				console.log(`🖼️  Converted: ${entry.name} -> ${jpgName} ${targetPath}`);
			} catch (err) {
				console.error(`⚠️  Failed to convert ${entry.name}: ${err.message}`);
			}
		} else {
			fs.copyFileSync(srcPath, destPath);
		}
	}
}

async function build() {
	console.log('Starting build...');

	// 1. Reset /dist
	if (fs.existsSync(DIST_DIR)) {
		fs.rmSync(DIST_DIR, { recursive: true, force: true });
	}
	fs.mkdirSync(DIST_DIR, { recursive: true });

	// 2. Process static files + convert .heic
	await copyAndConvertAssets(STATIC_DIR, DIST_DIR);

	// 3. Load Template
	const templatePath = path.join(TEMPLATES_DIR, 'base.html');
	const template = fs.readFileSync(templatePath, 'utf8');

	// 4. Compile Markdown
	const files = fs.readdirSync(CONTENT_DIR).filter(file => file.endsWith('.md'));

	for (const file of files) {
		sectionOpen = false;
		const filePath = path.join(CONTENT_DIR, file);
		const rawFile = fs.readFileSync(filePath, 'utf8');
		const { data: meta, content: markdownBody } = matter(rawFile);

		// Replace shortcodes and automatically rewrite .heic references to .jpg
		let processedBody = processShortcodes(markdownBody)
			.replace(/\.heic\b/gi, '.jpg');

		let renderedHtml = `<section>\n${md.render(processedBody)}\n</section>`
			.replace(/<section>\s*<\/section>/g, '');

		const finalHtml = template
			.replace(/{{title}}/g, meta.title || '')
			.replace(/{{date}}/g, meta.date || '')
			.replace('{{content}}', renderedHtml);

		const outputFileName = file.replace(/\.md$/, '.html');
		fs.writeFileSync(path.join(DIST_DIR, outputFileName), finalHtml);
		console.log(`✓ Compiled: content/${file} -> dist/${outputFileName}`);
	}

	console.log('Build complete. Ready in /dist');
}

build().catch(err => {
	console.error('Build failed:', err);
	process.exit(1);
});