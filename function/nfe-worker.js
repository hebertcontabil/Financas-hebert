/**
 * FinançasPRO — NF-e Proxy via Cloudflare Pages Functions
 * 
 * COMO USAR:
 * 1. Crie uma pasta chamada "functions" no seu repositório GitHub
 * 2. Coloque este arquivo dentro como "functions/nfe.js"
 * 3. O Cloudflare Pages vai criar automaticamente o endpoint:
 *    https://financas-hebert.pages.dev/nfe?chave=44digitos
 *    ou
 *    https://financas-hebert.pages.dev/nfe?qrurl=URL_DO_QRCODE
 */

export async function onRequest(context) {
  const { request } = context;
  
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS });
  }

  const url = new URL(request.url);
  const chave = url.searchParams.get('chave')?.replace(/\D/g, '');
  const qrurl = url.searchParams.get('qrurl');

  try {
    let produtos = [];
    let chaveEncontrada = chave || '';

    if (qrurl) {
      // Extrai chave da URL do QR Code
      const decoded = decodeURIComponent(qrurl);
      const match = decoded.match(/[?&]p=([^&]+)/);
      if (match) {
        const partes = match[1].split('|');
        if (partes[0]?.replace(/\D/g,'').length === 44) {
          chaveEncontrada = partes[0].replace(/\D/g,'');
        }
      }
      if (!chaveEncontrada) {
        const chaveMatch = decoded.match(/\d{44}/);
        if (chaveMatch) chaveEncontrada = chaveMatch[0];
      }
    }

    if (chaveEncontrada && chaveEncontrada.length === 44) {
      produtos = await consultarSefazSP(chaveEncontrada);
    }

    return new Response(JSON.stringify({
      ok: produtos.length > 0,
      chave: chaveEncontrada,
      produtos,
      msg: produtos.length === 0 ? 'Nenhum produto encontrado. Tente a URL do QR Code completa.' : null,
    }), { headers: CORS });

  } catch (e) {
    return new Response(JSON.stringify({
      ok: false,
      erro: e.message,
      produtos: [],
    }), { status: 500, headers: CORS });
  }
}

async function consultarSefazSP(chave) {
  // Portal público NFC-e SP
  const portalUrl = `https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?chNFe=${chave}&cIdToken=000001&cHashQRCode=`;
  
  const resp = await fetch(portalUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9',
    },
    redirect: 'follow',
  });

  const html = await resp.text();
  return parseNFeHtml(html);
}

function parseNFeHtml(html) {
  const produtos = [];
  
  // Padrão principal do portal SP: tabela de produtos
  // <span class="lblNome">PRODUTO</span> ... <span class="lblValorItem">R$ 9,99</span>
  const blocos = html.split(/class="[^"]*item[^"]*"/i);
  
  // Tenta extrair por spans típicos do SEFAZ-SP
  const nomeRe = /class="[^"]*Nome[^"]*"[^>]*>([^<]{2,80})<\/span>/gi;
  const qtdRe  = /class="[^"]*Qtd[^"]*"[^>]*>([\d,\.]+)\s*([A-Z]+)?/gi;
  const valRe  = /class="[^"]*Vl[^"]*Un[^"]*"[^>]*>R\$\s*([\d,\.]+)/gi;
  
  const nomes = [...html.matchAll(nomeRe)].map(m => m[1].trim());
  const qtds  = [...html.matchAll(qtdRe)].map(m => ({q: m[1], u: m[2]||'UN'}));
  const vals  = [...html.matchAll(valRe)].map(m => parseFloat(m[1].replace(/\./g,'').replace(',','.')));

  for (let i = 0; i < nomes.length && i < vals.length; i++) {
    const nome = nomes[i].replace(/\s+/g,' ');
    if (nome.length < 2) continue;
    produtos.push({
      nome,
      valor: vals[i] || 0,
      qtd: parseFloat(qtds[i]?.q || '1') || 1,
      unidade: qtds[i]?.u || 'UN',
    });
  }

  // Fallback: regex mais ampla para qualquer padrão
  if (!produtos.length) {
    const re = /([A-ZÁÉÍÓÚÀÂÊÔ][A-Za-záéíóúàâêôãõ\s\d\-\/\.]{3,50})\s*[\s\S]{0,300}?R\$\s*([\d]+[,\.][\d]{2})/g;
    let m;
    const vistos = new Set();
    while ((m = re.exec(html)) !== null && produtos.length < 80) {
      const nome = m[1].trim().replace(/\s+/g,' ');
      const valor = parseFloat(m[2].replace(',','.'));
      if (valor > 0 && valor < 5000 && !vistos.has(nome) && nome.length > 3) {
        vistos.add(nome);
        produtos.push({ nome, valor, qtd: 1, unidade: 'UN' });
      }
    }
  }

  return produtos;
}
