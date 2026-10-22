"use strict";
// Base stylesheet of the built-in design kit. Brand values arrive through the --ad-* variables (see brandVariables()).
// Logical properties and html[dir=rtl] rules keep it RTL-safe; columns stack on mobile.
module.exports = `/* ADActive design kit */
:root{--ad-primary:#1f4e79;--ad-accent:#e4572e;--ad-dark:#14213d;--ad-light:#f4f6f9;--ad-text:#1f2933;--ad-muted:#52606d;--ad-font-heading:system-ui,-apple-system,"Segoe UI",Arial,sans-serif;--ad-font-body:system-ui,-apple-system,"Segoe UI",Arial,sans-serif;--ad-radius:12px;--ad-max:1140px;--ad-gap:clamp(16px,3vw,32px);--ad-pad:clamp(40px,7vw,88px)}
body{font-family:var(--ad-font-body);color:var(--ad-text);font-size:1rem;line-height:1.7}
h1,h2,h3,h4{font-family:var(--ad-font-heading);color:var(--ad-dark);line-height:1.2;overflow-wrap:anywhere;margin-block:0 .5em}
p,li{overflow-wrap:anywhere}
a{color:var(--ad-primary)}
img{max-width:100%;height:auto}
.ad-section{padding-block:var(--ad-pad);padding-inline:var(--ad-gap);box-sizing:border-box}
.ad-section>*{max-width:var(--ad-max)}
.ad-section h2{font-size:clamp(1.5rem,3.2vw,2.25rem);text-align:center}
.ad-section .ad-lead{text-align:center;color:var(--ad-muted);max-width:720px;margin-inline:auto}
.ad-tint{background:var(--ad-light)}
.ad-dark{background:var(--ad-dark);color:#fff}
.ad-dark h1,.ad-dark h2,.ad-dark h3,.ad-dark p,.ad-dark a:not(.wp-block-button__link){color:#fff}
.ad-hero h1{font-size:clamp(2rem,4.6vw,3.25rem)}
.ad-hero p{font-size:clamp(1.05rem,2vw,1.25rem)}
.ad-hero.wp-block-cover{min-height:min(70vh,560px);color:#fff}
.ad-hero.wp-block-cover h1,.ad-hero.wp-block-cover p{color:#fff}
.ad-hero--simple{text-align:center;background:var(--ad-dark);color:#fff}
.ad-hero--simple h1,.ad-hero--simple p{color:#fff}
.ad-actions{gap:12px;justify-content:center}
.ad-btn .wp-block-button__link{background:var(--ad-accent);color:#fff;border-radius:999px;padding:.75em 1.6em;font-weight:600;text-decoration:none;font-size:1rem;line-height:1.3}
.ad-btn .wp-block-button__link:hover,.ad-btn .wp-block-button__link:focus-visible{filter:brightness(1.08)}
.ad-grid{gap:var(--ad-gap);align-items:stretch}
.ad-card{background:#fff;color:var(--ad-text);border-radius:var(--ad-radius);padding:1.5rem;box-shadow:0 2px 14px rgba(20,33,61,.08);height:100%;box-sizing:border-box}
.ad-tint .ad-card{box-shadow:0 2px 14px rgba(20,33,61,.1)}
.ad-card h3{font-size:1.2rem;color:var(--ad-primary)}
.ad-card p{margin:0;color:var(--ad-muted)}
.ad-card img,.ad-media img{border-radius:calc(var(--ad-radius) - 4px)}
.ad-icon{margin-block-end:.75rem}
.ad-icon img{width:64px;height:64px;object-fit:contain}
.ad-split{gap:calc(var(--ad-gap) * 1.5);align-items:center}
.ad-split.ad-side-left{flex-direction:row-reverse}
html[dir=rtl] .ad-split.ad-side-left{flex-direction:row}
html[dir=rtl] .ad-split.ad-side-right{flex-direction:row-reverse}
.ad-feature{border-inline-start:4px solid var(--ad-accent);padding-inline-start:1rem;margin-block-end:1rem}
.ad-feature h3{font-size:1.1rem;margin-block-end:.25em}
.ad-feature p{margin:0;color:var(--ad-muted)}
.ad-quote{background:#fff;border-radius:var(--ad-radius);padding:1.5rem;border:0;box-shadow:0 2px 14px rgba(20,33,61,.08);margin:0}
.ad-quote cite{display:block;margin-block-start:.75rem;font-style:normal;font-weight:600;color:var(--ad-primary)}
.ad-cta{background:var(--ad-primary);color:#fff;text-align:center}
.ad-cta h2,.ad-cta p{color:#fff}
.ad-cta .ad-btn .wp-block-button__link{background:#fff;color:var(--ad-primary)}
.ad-contact-item{text-align:center}
.ad-contact-item strong{display:block;color:var(--ad-primary)}
.ad-header{padding:12px var(--ad-gap);gap:12px 24px;align-items:center;box-sizing:border-box}
.ad-header .wp-block-site-logo img{height:auto;max-height:64px;width:auto}
.ad-footer{padding:clamp(32px,5vw,56px) var(--ad-gap);background:var(--ad-dark);color:#fff;box-sizing:border-box}
.ad-footer a,.ad-footer p,.ad-footer h3{color:#fff}
.ad-footer p{margin:0 0 .5em}
.ad-footer .wp-block-social-links{gap:10px}
body:has(.site-hero) :is(.wp-block-post-title,.entry-title,.page-title,.entry-header,.page-header){display:none}
.ad-section,.ad-hero,.ad-footer,.ad-header{margin-block:0 !important}
body:has(.site-hero) .wp-site-blocks>*+*{margin-block-start:0 !important}
body:has(.site-hero) :is(main,.site-main,#primary,#content,.wp-site-blocks>.wp-block-group,.wp-block-post-content,.entry-content){margin-block-start:0 !important;padding-block-start:0 !important}
body:has(.site-hero) :is(.wp-block-post-content,.entry-content).has-global-padding{padding-inline:0 !important}
body:has(.site-hero) :is(.wp-block-post-content,.entry-content)>*{margin-block-start:0 !important}
@media (max-width:781px){
.ad-split{flex-direction:column !important}
.ad-grid{gap:16px}
.ad-header{justify-content:center}
.ad-hero.wp-block-cover{min-height:420px}
.ad-actions{justify-content:center}
}
`;
