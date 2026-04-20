/**
 * build.js — Build-Time Injection for Static HTML Sites
 *
 * Processes all src/*.html files:
 *   - Replaces INCLUDE markers with content from _includes/
 *   - Injects JSON-LD schema (global + per-page)
 *   - Generates sitemap.xml and robots.txt
 *   - Copies Assets/ to dist/
 *
 * Outputs to dist/ for Cloudflare Pages deployment.
 */

const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');

const INCLUDES_DIR = '_includes';
const SRC_DIR = 'src';
const DIST_DIR = 'dist';
const SCHEMA_DIR = path.join(INCLUDES_DIR, 'schema');

// ── Helpers ─────────────────────────────────────────────────────────────────

function readInclude(name) {
    const filePath = path.join(INCLUDES_DIR, name);
    if (!fs.existsSync(filePath)) return '';
    return fs.readFileSync(filePath, 'utf8').trim();
}

function readJsonInclude(filePath) {
    if (!fs.existsSync(filePath)) return null;
    try {
        const content = fs.readFileSync(filePath, 'utf8').trim();
        JSON.parse(content);
        return content;
    } catch (e) {
        console.warn("Warning: Invalid JSON in " + filePath + ": " + e.message);
        return null;
    }
}

// ── Setup dist ──────────────────────────────────────────────────────────────

if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true });
}
fs.mkdirSync(DIST_DIR, { recursive: true });

// ── Read site-wide includes ─────────────────────────────────────────────────

var header = readInclude('header.html');
var footer = readInclude('footer.html');
const headScripts = readInclude('head_scripts.html');
const bodyScripts = readInclude('body_scripts.html');
const faviconHtml = readInclude('favicon.html');
const globalSchemaJson = readJsonInclude(path.join(SCHEMA_DIR, 'global.json'));

// ── Read template variable data ─────────────────────────────────────────────

var siteDataStr = readJsonInclude(path.join(INCLUDES_DIR, 'site-data.json'));
var siteData = siteDataStr ? JSON.parse(siteDataStr) : {};
var PAGE_DATA_DIR = path.join(INCLUDES_DIR, 'page-data');
console.log("   Site data: " + (siteDataStr ? Object.keys(siteData).length + " var(s)" : "none"));

// ── Read nav data ───────────────────────────────────────────────────────────

var navJsonStr = readJsonInclude(path.join(INCLUDES_DIR, 'nav.json'));
var navTemplatesStr = readJsonInclude(path.join(INCLUDES_DIR, 'nav_templates.json'));

console.log('Build-Time Injection starting...');
console.log("   Header: " + (header ? header.length + " chars" : "not found"));
console.log("   Footer: " + (footer ? footer.length + " chars" : "not found"));
console.log("   Head scripts: " + (headScripts ? headScripts.length + " chars" : "none"));
console.log("   Body scripts: " + (bodyScripts ? bodyScripts.length + " chars" : "none"));
console.log("   Global schema: " + (globalSchemaJson ? "yes" : "none"));
console.log("   Nav data: " + (navJsonStr ? "yes" : "none"));

// ── Inject nav items into header ────────────────────────────────────────────

if (navJsonStr && navTemplatesStr && header) {
    try {
        var navItems = JSON.parse(navJsonStr);
        var templates = JSON.parse(navTemplatesStr);

        // Build desktop nav HTML
        var desktopHtml = navItems.map(function(item) {
            if (item.children && item.children.length > 0 && templates.nav_dropdown) {
                var childHtml = item.children.map(function(c) {
                    return (templates.nav_dropdown_item || "")
                        .replace(/\{\{href\}\}/g, c.href)
                        .replace(/\{\{label\}\}/g, c.label);
                }).join("\n                        ");
                var slug = item.label.toLowerCase().replace(/\s+/g, "-");
                return templates.nav_dropdown
                    .replace(/\{\{label\}\}/g, item.label)
                    .replace(/\{\{slug\}\}/g, slug)
                    .replace("<!-- DROPDOWN_ITEMS -->", childHtml);
            }
            return (templates.nav_item || "")
                .replace(/\{\{href\}\}/g, item.href)
                .replace(/\{\{label\}\}/g, item.label);
        }).join("\n                ");

        // Build mobile nav HTML
        var mobileHtml = navItems.map(function(item) {
            if (item.children && item.children.length > 0 && templates.mobile_nav_dropdown) {
                var childHtml = item.children.map(function(c) {
                    return (templates.mobile_nav_dropdown_item || "")
                        .replace(/\{\{href\}\}/g, c.href)
                        .replace(/\{\{label\}\}/g, c.label);
                }).join("\n                        ");
                return templates.mobile_nav_dropdown
                    .replace(/\{\{label\}\}/g, item.label)
                    .replace("<!-- MOBILE_DROPDOWN_ITEMS -->", childHtml);
            }
            return (templates.mobile_nav_item || "")
                .replace(/\{\{href\}\}/g, item.href)
                .replace(/\{\{label\}\}/g, item.label);
        }).join("\n                ");

        header = header.replace("<!-- NAV_ITEMS_DESKTOP -->", desktopHtml);
        header = header.replace("<!-- NAV_ITEMS_MOBILE -->", mobileHtml);

        // Build footer nav HTML
        if (templates.footer_nav_item) {
            var footerNavHtml = navItems.map(function(item) {
                return templates.footer_nav_item
                    .replace(/\{\{href\}\}/g, item.href)
                    .replace(/\{\{label\}\}/g, item.label);
            }).join("\n                        ");
            footer = footer.replace("<!-- NAV_ITEMS_FOOTER -->", footerNavHtml);
        }

        console.log("   Nav: injected " + navItems.length + " item(s) into header + footer");
    } catch (navErr) {
        console.warn("   Nav injection warning: " + navErr.message);
    }
}

// ── Conditional nav interaction JS (only when dropdowns exist) ────────────
// Only strip pattern-specific JS and inject universal handlers if the site
// has dropdown nav templates. Otherwise, leave the original header JS alone.
if (templates && templates.nav_dropdown) {
    // Strip pattern-specific toggle functions that reference hardcoded IDs
    header = header.replace(/<script>[\s\S]*?toggleDropdown[\s\S]*?<\/script>/gi, "");
    header = header.replace(/<script>[\s\S]*?toggleMobileMenu[\s\S]*?<\/script>/gi, "");

    // Inject universal nav interaction script
    var navInteractionScript = [
        "<script>",
        "(function(){",
        "  var mobileBtn=document.getElementById('mobile-menu-trigger');",
        "  var mobileMenu=document.getElementById('mobile-menu');",
        "  var hamburgerIcon=document.getElementById('hamburger-icon');",
        "  if(mobileBtn&&mobileMenu){",
        "    mobileBtn.addEventListener('click',function(){",
        "      var v=mobileMenu.classList.contains('opacity-100');",
        "      if(v){mobileMenu.classList.remove('opacity-100','visible');mobileMenu.classList.add('opacity-0','invisible');if(hamburgerIcon)hamburgerIcon.innerHTML='<path stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" d=\"M4 6h16M4 12h16M4 18h16\"></path>';}",
        "      else{mobileMenu.classList.remove('opacity-0','invisible');mobileMenu.classList.add('opacity-100','visible');if(hamburgerIcon)hamburgerIcon.innerHTML='<path stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" d=\"M6 18L18 6M6 6l12 12\"></path>';}",
        "    });",
        "  }",
        "  document.addEventListener('click',function(e){",
        "    var triggers=document.querySelectorAll('[id$=\"-trigger\"]');",
        "    var clicked=null;",
        "    triggers.forEach(function(t){if(t.contains(e.target))clicked=t;});",
        "    triggers.forEach(function(trigger){",
        "      if(trigger.id==='mobile-menu-trigger')return;",
        "      var pid=trigger.id.replace('-trigger','');",
        "      var panel=document.getElementById(pid);",
        "      var chev=trigger.querySelector('svg');",
        "      if(!panel)return;",
        "      if(trigger===clicked){",
        "        var open=panel.classList.contains('opacity-100');",
        "        if(open){panel.classList.remove('opacity-100','visible');panel.classList.add('opacity-0','invisible');if(chev)chev.classList.remove('rotate-180');}",
        "        else{panel.classList.remove('opacity-0','invisible');panel.classList.add('opacity-100','visible');if(chev)chev.classList.add('rotate-180');}",
        "      }else if(!panel.contains(e.target)){",
        "        panel.classList.remove('opacity-100','visible');panel.classList.add('opacity-0','invisible');if(chev)chev.classList.remove('rotate-180');",
        "      }",
        "    });",
        "  });",
        "})();",
        "</script>"
    ].join("\n");

    if (header.indexOf("</header>") !== -1) {
        header = header.replace("</header>", "</header>\n" + navInteractionScript);
    } else {
        header = header + "\n" + navInteractionScript;
    }
    console.log("   Nav interactions: injected universal dropdown/mobile JS");
} else {
    console.log("   Nav interactions: no dropdown templates found — keeping original header JS");
}

// ── Process HTML files ──────────────────────────────────────────────────────

if (!fs.existsSync(SRC_DIR)) {
    console.error("ERROR: Source directory " + SRC_DIR + " not found!");
    process.exit(1);
}

const htmlFiles = fs.readdirSync(SRC_DIR).filter(function(f) { return f.endsWith('.html'); });
console.log("   Found " + htmlFiles.length + " HTML file(s) in src/");

var processedPages = [];

for (var i = 0; i < htmlFiles.length; i++) {
    var file = htmlFiles[i];
    var inputPath = path.join(SRC_DIR, file);
    var outputPath = path.join(DIST_DIR, file);
    var slug = file.replace('.html', '');

    var html = fs.readFileSync(inputPath, 'utf8');

    // Replace INCLUDE markers (site-level)
    html = html.replace('<!-- INCLUDE:header -->', header);
    html = html.replace('<!-- INCLUDE:footer -->', footer);

    // Head scripts: site-level + per-page
    var pageHeadScripts = readInclude(path.join('pages', slug, 'head_scripts.html'));
    var combinedHeadScripts = [headScripts, pageHeadScripts].filter(Boolean).join("\n");
    html = html.replace('<!-- INCLUDE:head_scripts -->', combinedHeadScripts);

    // Body scripts: site-level + per-page
    var pageBodyScripts = readInclude(path.join('pages', slug, 'body_scripts.html'));
    var combinedBodyScripts = [bodyScripts, pageBodyScripts].filter(Boolean).join("\n");
    html = html.replace('<!-- INCLUDE:body_scripts -->', combinedBodyScripts);

    html = html.replace('<!-- INCLUDE:favicon -->', faviconHtml);

    // Build schema injection
    var schemas = [];
    if (globalSchemaJson) {
        schemas.push('<script type="application/ld+json">' + globalSchemaJson + '</script>');
    }

    // Per-page schema
    var pageSchemaJson = readJsonInclude(path.join(SCHEMA_DIR, slug + '.json'));
    if (pageSchemaJson) {
        schemas.push('<script type="application/ld+json">' + pageSchemaJson + '</script>');
    }

    html = html.replace('<!-- INCLUDE:schema -->', schemas.join('\n    '));

    // ── Template variable replacement (Handlebars) ──
    if (Object.keys(siteData).length > 0 || fs.existsSync(PAGE_DATA_DIR)) {
        try {
            var pageDataStr = readJsonInclude(path.join(PAGE_DATA_DIR, slug + '.json'));
            var pageData = pageDataStr ? JSON.parse(pageDataStr) : {};
            var templateData = Object.assign({}, siteData, { page: pageData });
            // Register helperMissing: unrecognized {{expressions}} pass through unchanged
            Handlebars.registerHelper("helperMissing", function() {
                var options = arguments[arguments.length - 1];
                return new Handlebars.SafeString("{{" + options.name + "}}");
            });
            var template = Handlebars.compile(html, { noEscape: true, strict: false });
            html = template(templateData);
        } catch (hbsErr) {
            console.warn("   ⚠ Handlebars warning for " + file + ": " + hbsErr.message);
        }
    }

    fs.writeFileSync(outputPath, html, 'utf8');
    processedPages.push(file);
    console.log("   OK: " + file);
}

// ── Copy Assets ─────────────────────────────────────────────────────────────

var assetsDir = 'Assets';
if (fs.existsSync(assetsDir)) {
    var destAssets = path.join(DIST_DIR, 'Assets');
    fs.cpSync(assetsDir, destAssets, { recursive: true });
    var assetCount = fs.readdirSync(destAssets).length;
    console.log("   Copied " + assetCount + " asset(s) to dist/Assets/");
}

// ── Generate sitemap.xml ────────────────────────────────────────────────────

var configPath = 'build-config.json';
var sitemapDomain = '';
if (fs.existsSync(configPath)) {
    try {
        var config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        sitemapDomain = (config.domain || '').replace(/\/+$/, '');
    } catch (e) {
        console.warn("Warning: Could not read build-config.json: " + e.message);
    }
}

if (sitemapDomain) {
    var urls = processedPages.map(function(file) {
        var isIndex = file === 'index.html' || file === 'home.html';
        var loc = isIndex ? sitemapDomain + '/' : sitemapDomain + '/' + file;
        return '  <url>\n    <loc>' + loc + '</loc>\n  </url>';
    });

    var sitemapXml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        urls.join('\n') + '\n' +
        '</urlset>';

    fs.writeFileSync(path.join(DIST_DIR, 'sitemap.xml'), sitemapXml, 'utf8');
    console.log("   Generated sitemap.xml with " + urls.length + " URL(s)");

    // Generate robots.txt
    var robotsTxt = 'User-agent: *\nAllow: /\nSitemap: ' + sitemapDomain + '/sitemap.xml';

    fs.writeFileSync(path.join(DIST_DIR, 'robots.txt'), robotsTxt, 'utf8');
    console.log('   Generated robots.txt');
} else {
    console.log('   No domain in build-config.json - skipping sitemap/robots');
}

// ── Copy _redirects if it exists ────────────────────────────────────────────

if (fs.existsSync('_redirects')) {
    fs.copyFileSync('_redirects', path.join(DIST_DIR, '_redirects'));
    console.log('   Copied _redirects');
}

console.log('');
console.log('Build complete! Output: ' + DIST_DIR + '/');