// JSON-LD 출력 공용 유틸리티. JSON.stringify 결과를 HTML script 안에 안전하게 넣는다.
export function jsonLdScript(value) {
  const json = JSON.stringify(value).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}

export function personOrOrganization({ name, url, organizationName, organizationUrl } = {}) {
  if (name) return { "@type": "Person", name, ...(url ? { url } : {}) };
  return { "@type": "Organization", name: organizationName, ...(organizationUrl ? { url: organizationUrl } : {}) };
}
