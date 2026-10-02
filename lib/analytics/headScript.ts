/**
 * The inline <head> script that runs before Google Tag Manager may load
 * (docs/analytics.md, "Consent" and "Under-13 off switch"). Kept to ES5 so it
 * runs on the oldest TV browsers (LG webOS, Chromium 79) even where the app's
 * modern bundle does not.
 *
 * In order, it:
 * 1. sets up `dataLayer` and a `gtag` stub;
 * 2. leaves Tag Manager off on a device with an under-13 flag, and sets
 *    `ga-disable-<id>` so nothing at all reaches Google Analytics;
 * 3. leaves it off on any host but luddohouse.com and www.luddohouse.com
 *    (preview deployments, other subdomains, localhost), unless GTM Preview (`gtm_debug`) or the
 *    `luddo-analytics-debug` flag asks for it; such hits are marked debug;
 * 4. pushes Consent Mode v2 defaults: no ads signals anywhere, and analytics
 *    denied in the EEA, the UK and Switzerland, where the container's GA
 *    tags then do not fire at all;
 * 5. sets `__luddoTagsOn`, which the GTM snippet and lib/analytics check.
 *
 * The flags' keys must match lib/analytics/children.ts.
 */

// EEA member states, plus the UK and Switzerland (ISO 3166-1 alpha-2).
export const CONSENT_REQUIRED_REGIONS = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT",
  "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO",
  "GB", "CH",
];

export function analyticsHeadScript(gaMeasurementId: string): string {
  const regions = JSON.stringify(CONSENT_REQUIRED_REGIONS);
  const id = JSON.stringify(gaMeasurementId);
  return `(function(){var w=window;w.dataLayer=w.dataLayer||[];function gtag(){w.dataLayer.push(arguments);}w.gtag=w.gtag||gtag;w.__luddoGaId=${id};w.__luddoTagsOn=false;var off=false,debug=false;try{var d=new Date();var p=function(n){return n<10?'0'+n:''+n;};var today=d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());var a=w.localStorage.getItem('luddo-under-13-until');var b=w.localStorage.getItem('luddo-analytics-off-until');if((a&&a>today)||(b&&b>today))off=true;if(w.localStorage.getItem('luddo-analytics-debug')==='1')debug=true;}catch(e){}if(off){w['ga-disable-'+${id}]=true;return;}var prod=/^(www\\.)?luddohouse\\.com$/.test(w.location.hostname);if(/[?&]gtm_debug=/.test(w.location.search))debug=true;if(!prod&&!debug)return;w.__luddoDebug=!prod;gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',region:${regions}});gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'granted'});w.__luddoTagsOn=true;})();`;
}

/** The standard GTM loader, run only when the head script allowed it. */
export function gtmLoaderScript(containerId: string): string {
  return `if(window.__luddoTagsOn){(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer',${JSON.stringify(containerId)});}`;
}
