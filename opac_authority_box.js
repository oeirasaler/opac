/* ================================================================================
   ENTITY-BOX / OPAC
   Versão 1.0
   Autor: Miguel Mimoso Correia

   Finalidade
   ----------
   Apresenta uma caixa pública de entidade exclusivamente nas fichas bibliográficas
   do OPAC, enriquecendo os pontos de acesso de autor através das autoridades
   locais, Wikidata, Wikipédia e identificadores externos disponíveis.

   Página-alvo
   -----------
   /cgi-bin/koha/opac-detail.pl

   NOTA
   ----
   Esta versão corresponde a uma refatoração nominal do componente anteriormente
   designado AuthBox. A lógica funcional original foi preservada.
   O módulo da página individual de autoridade foi removido desta versão.
   ================================================================================ */

(function () {
  'use strict';

  const CONFIG = {
    cacheNamespace: 'entity-box',
    maxAutoridades: 12,
    maxVisiveis: 3,
    titulo: 'Autor(es)',
    notaFinal: '<strong>Fontes: Wikidata e Wikipédia</strong><br>Informação de origem externa.',
    mensagemSemQID: 'Ligação indisponível',
    mostrarAutoresSemQID: true,
    cacheMinutos: 15,
    langs: ['pt', 'pt-br', 'en', 'fr', 'es'],

    camposValidos: [
      'autor',
      'co-autor'
    ],

    camposExcluidos: [
      'nome pessoal',
      'nome comum',
      'assunto',
      'assuntos',
      'nome geográfico',
      'assunto geográfico',
      'coleção',
      'título',
      'título original'
    ],

    papeis: [
      'Autor',
      'Co-autor',
      'Tradutor',
      'Editor literário',
      'Introdução',
      'Ilustrador',
      'Prefácio',
      'Seleção',
      'Organizador',
      'Coordenador',
      'Compilador',
      'Comentador',
      'Anotador',
      'Adaptador'
    ],

    externalIds: [
      { prop: 'P214', label: 'VIAF', url: 'https://viaf.org/viaf/$1' },
      { prop: 'P1005', label: 'BNP', url: 'http://id.bnportugal.gov.pt/aut/catbnp/$1' },
      { prop: 'P244', label: 'LoC', url: 'https://id.loc.gov/authorities/names/$1' },
      { prop: 'P268', label: 'BnF', url: 'https://catalogue.bnf.fr/ark:/12148/cb$1' },
      { prop: 'P227', label: 'GND', url: 'https://d-nb.info/gnd/$1' }
    ]
  };

  const cacheQID = new Map();
  const cacheWikidata = new Map();
  const cacheLabels = new Map();
  const cacheWikipedia = new Map();

  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(initEntityBox, 900);
  });

  async function initEntityBox() {
    if (!location.href.includes('opac-detail.pl')) return;

    const autores = recolherAutores();
    if (!autores.length) return;

    criarCaixa();

    const qidsMostrados = new Set();
    let encontrados = 0;

    for (const autor of autores.slice(0, CONFIG.maxAutoridades)) {
      const qid = await obterQID(autor.authid);

      if (qid && qidsMostrados.has(qid)) continue;
      if (qid) qidsMostrados.add(qid);

      const html = qid
        ? await construirCartaoComWikidata(qid, autor)
        : construirCartaoSemWikidata(autor);

      if (html) {
        encontrados++;
        document.querySelector('#entity-box-content').insertAdjacentHTML('beforeend', html);
      }
    }

    if (!encontrados) {
      document.querySelector('#entity-box-content').innerHTML =
        '<div class="entity-box-empty">' + escapeHtml(CONFIG.mensagemSemQID) + '</div>';
    }

    atualizarContador();
    aplicarColapso();
  }

  function recolherAutores() {
    const autores = [];

    document.querySelectorAll('tr').forEach(function (tr) {
      const celulas = tr.querySelectorAll('td, th');
      if (celulas.length < 2) return;

      const label = mapearLabel(celulas[0].textContent);
      if (!CONFIG.camposValidos.includes(label)) return;

      const links = Array.from(celulas[1].querySelectorAll('a[href*="opac-search.pl"][href*="q="]'));

      links.forEach(function (a) {
        const texto = limparTexto(a.textContent);
        const authid = extrairAuthId(a.href);

        if (!texto || !authid) return;

        autores.push({
          nome: limparNomeAutor(texto),
          nomeOriginal: texto,
          href: a.href,
          authid: authid,
          papeis: extrairPapeisDoTexto(texto, label)
        });
      });
    });

    if (!autores.length) {
      const links = Array.from(
        document.querySelectorAll('a[href*="opac-search.pl"][href*="q="]')
      );

      links.forEach(function (a) {
        const texto = limparTexto(a.textContent);
        const authid = extrairAuthId(a.href);

        if (!texto || !authid) return;

        const contexto = obterContextoDoLink(a);
        const label = obterLabelDoLink(a, contexto);

        if (CONFIG.camposExcluidos.includes(label)) return;
        if (pareceAssunto(contexto)) return;

        if (CONFIG.camposValidos.includes(label) || pareceResponsabilidade(contexto, texto)) {
          autores.push({
            nome: limparNomeAutor(texto),
            nomeOriginal: texto,
            href: a.href,
            authid: authid,
            papeis: extrairPapeisDoTexto(texto, label)
          });
        }
      });
    }

    return autores
      .filter(function (a) {
        return a.nome && a.authid;
      })
      .filter(function (a, i, arr) {
        return arr.findIndex(function (b) {
          return b.authid === a.authid;
        }) === i;
      });
  }

  function obterContextoDoLink(link) {
    const bloco =
      link.closest('.results_summary') ||
      link.closest('tr') ||
      link.closest('li') ||
      link.closest('p') ||
      link.closest('div') ||
      link.parentElement;

    return limparTexto(bloco ? bloco.textContent : link.textContent);
  }

  function obterLabelDoLink(link, contexto) {
    const blocos = [
      link.closest('.results_summary'),
      link.closest('tr'),
      link.closest('li'),
      link.closest('p'),
      link.parentElement
    ].filter(Boolean);

    for (const bloco of blocos) {
      const labelEl =
        bloco.querySelector('.label') ||
        bloco.querySelector('th') ||
        bloco.querySelector('td:first-child') ||
        bloco.querySelector('span:first-child');

      if (!labelEl) continue;

      const label = mapearLabel(labelEl.textContent);
      if (CONFIG.camposValidos.includes(label)) return label;
      if (CONFIG.camposExcluidos.includes(label)) return label;
    }

    return mapearLabel(contexto);
  }

  function mapearLabel(texto) {
    const t = normalizarTexto(texto);

    if (t.startsWith('co-autor')) return 'co-autor';
    if (t.startsWith('autor')) return 'autor';

    if (t.startsWith('nome pessoal')) return 'nome pessoal';
    if (t.startsWith('nome comum')) return 'nome comum';
    if (t.startsWith('assunto geográfico')) return 'assunto geográfico';
    if (t.startsWith('nome geográfico')) return 'nome geográfico';
    if (t.startsWith('assunto')) return 'assunto';
    if (t.startsWith('coleção')) return 'coleção';
    if (t.startsWith('título original')) return 'título original';
    if (t.startsWith('título')) return 'título';

    return '';
  }

  function pareceAssunto(contexto) {
    const t = normalizarTexto(contexto);

    return (
      t.startsWith('nome pessoal') ||
      t.startsWith('nome comum') ||
      t.startsWith('assunto') ||
      t.includes(' -- ') ||
      t.includes('[biografias]') ||
      t.includes('[novelas gráficas]') ||
      t.includes('[publicações infantis]')
    );
  }

  function pareceResponsabilidade(contexto, textoLink) {
    const t = normalizarTexto(contexto);
    const link = normalizarTexto(textoLink);

    if (t.startsWith('autor secundário')) return false;
    if (t.startsWith('co-autor')) return true;
    if (t.startsWith('autor')) return true;

    return CONFIG.papeis.some(function (papel) {
      return link.includes(normalizarTexto(papel));
    });
  }

  function limparNomeAutor(texto) {
    let nome = limparTexto(texto);

    CONFIG.papeis.forEach(function (papel) {
      const re = new RegExp(',?\\s*' + escapeRegExp(papel) + '\\s*$', 'i');
      nome = nome.replace(re, '');
    });

    return limparTexto(nome);
  }

  function extrairPapeisDoTexto(texto, labelLinha) {
    const encontrados = [];

    CONFIG.papeis.forEach(function (papel) {
      const re = new RegExp('(^|,|\\s)' + escapeRegExp(papel) + '($|,|\\s)', 'i');
      if (re.test(texto)) encontrados.push(papel);
    });

    if (!encontrados.length) {
      if (labelLinha === 'autor') encontrados.push('Autor');
      if (labelLinha === 'co-autor') encontrados.push('Co-autor');
    }

    return encontrados;
  }

  function extrairAuthId(url) {
    try {
      const u = new URL(url, location.origin);

      if (u.searchParams.get('authid')) {
        return u.searchParams.get('authid');
      }

      if (u.searchParams.get('q')) {
        return u.searchParams.get('q');
      }

      return null;
    } catch (e) {
      const m =
        url.match(/[?&]authid=(\d+)/i) ||
        url.match(/[?&]q=(\d+)/i) ||
        url.match(/an:(\d+)/i);

      return m ? m[1] : null;
    }
  }

  async function obterQID(authid) {
    if (cacheQID.has(authid)) return cacheQID.get(authid);

    try {
      const url = '/cgi-bin/koha/opac-authoritiesdetail.pl?authid=' +
        encodeURIComponent(authid) +
        '&marc=1';

      const response = await fetch(url, {
        credentials: 'same-origin',
        cache: 'no-store'
      });

      if (!response.ok) {
        cacheQID.set(authid, null);
        return null;
      }

      const html = await response.text();
      const qid = extrairQIDWikidata(html);

      cacheQID.set(authid, qid);

      return qid;
    } catch (e) {
      console.warn('Entity Box: erro ao obter QID', authid, e);
      cacheQID.set(authid, null);
      return null;
    }
  }

  function extrairQIDWikidata(html) {
    const texto = String(html || '').replace(/\s+/g, ' ');
    const matches = Array.from(texto.matchAll(/Q\d{3,}/g));

    for (const match of matches) {
      const pos = match.index;
      const contexto = texto.slice(Math.max(0, pos - 350), pos + 350).toLowerCase();

      if (contexto.includes('wikidata')) {
        return match[0];
      }
    }

    return null;
  }

  async function obterEntidade(qid) {
    if (cacheWikidata.has(qid)) return cacheWikidata.get(qid);

    const key = 'entity_box_' + CONFIG.cacheNamespace + '_wd_' + qid;
    const cached = lerSessionCache(key);

    if (cached !== undefined) {
      cacheWikidata.set(qid, cached);
      return cached;
    }

    try {
      const url = 'https://www.wikidata.org/wiki/Special:EntityData/' +
        encodeURIComponent(qid) +
        '.json';

      const response = await fetch(url);

      if (!response.ok) {
        cacheWikidata.set(qid, null);
        return null;
      }

      const data = await response.json();
      const entidade = data.entities[qid];

      if (!entidade || entidade.missing) {
        cacheWikidata.set(qid, null);
        return null;
      }

      cacheWikidata.set(qid, entidade);
      gravarSessionCache(key, entidade);

      return entidade;
    } catch (e) {
      console.warn('Entity Box: erro Wikidata', qid, e);
      cacheWikidata.set(qid, null);
      return null;
    }
  }

  async function construirCartaoComWikidata(qid, autor) {
    const entidade = await obterEntidade(qid);
    if (!entidade) return construirCartaoSemWikidata(autor);

    const principal = !document.querySelector('.entity-box-card');

    const label = obterTextoMultilingue(entidade.labels) || autor.nome || qid;
    const descricao = obterDescricaoPT(entidade);
    const imagem = obterValorClaim(entidade, 'P18');
    const nascimento = obterDataClaim(entidade, 'P569');
    const morte = obterDataClaim(entidade, 'P570');

    const paisIds = obterEntityIdsClaim(entidade, 'P27').slice(0, 3);
    const localNascimentoId = obterEntityIdClaim(entidade, 'P19');
    const localMorteId = obterEntityIdClaim(entidade, 'P20');
    const premiosIds = obterEntityIdsClaim(entidade, 'P166').slice(0, 4);

    const labels = await obterLabels([
      localNascimentoId,
      localMorteId
    ].concat(paisIds, premiosIds).filter(Boolean));

    const paises = paisIds.map(function (id) {
      return labels[id];
    }).filter(Boolean);

    const localNascimento = localNascimentoId ? labels[localNascimentoId] : '';
    const localMorte = localMorteId ? labels[localMorteId] : '';
    const premios = premiosIds.map(function (id) {
      return labels[id];
    }).filter(Boolean);

    const wikipediaInfo = obterWikipediaInfo(entidade, label);
    const resumoWikipedia = wikipediaInfo ? await obterResumoWikipedia(wikipediaInfo) : null;
    const externos = obterIdentificadoresExternos(entidade);

    let html = '<article class="entity-box-card ' +
      (principal ? 'entity-box-card-main' : 'entity-box-card-compact') +
      '">';

    html += '<div class="entity-box-top">';

    if (imagem) {
      html +=
        '<div class="entity-box-photo">' +
          '<img src="' + escapeAttr(imagemCommons(imagem)) + '" alt="">' +
        '</div>';
    } else {
      html +=
        '<div class="entity-box-photo entity-box-photo-empty">' +
          '<span>' + escapeHtml(iniciais(label)) + '</span>' +
        '</div>';
    }

    html +=
      '<div class="entity-box-heading">' +
        '<div class="entity-box-name">' + escapeHtml(label) + '</div>' +
        renderPapeis(autor.papeis) +
        (descricao ? '<div class="entity-box-desc">' + escapeHtml(descricao) + '</div>' : '') +
      '</div>' +
    '</div>';

    html += '<dl class="entity-box-facts">';

    if (paises.length) {
      html +=
        '<div>' +
          '<dt>País</dt>' +
          '<dd>' + paises.map(escapeHtml).join('; ') + '</dd>' +
        '</div>';
    }

    if (nascimento || localNascimento) {
      html +=
        '<div>' +
          '<dt>Nascimento</dt>' +
          '<dd>' + escapeHtml(nascimento || 'Data não indicada') +
          (localNascimento ? ', ' + escapeHtml(localNascimento) : '') +
          '</dd>' +
        '</div>';
    }

    if (morte || localMorte) {
      html +=
        '<div>' +
          '<dt>Morte</dt>' +
          '<dd>' + escapeHtml(morte || 'Data não indicada') +
          (localMorte ? ', ' + escapeHtml(localMorte) : '') +
          '</dd>' +
        '</div>';
    }

    if (premios.length) {
      html +=
        '<div>' +
          '<dt>Prémios</dt>' +
          '<dd>' + premios.map(escapeHtml).join('; ') + '</dd>' +
        '</div>';
    }

    html += '</dl>';

    if (resumoWikipedia && resumoWikipedia.extract) {
      html += '<div class="entity-box-wikipedia-summary">';
      html += '<div class="entity-box-wikipedia-label">Wikipédia</div>';
      html += '<p>' + escapeHtml(resumoWikipedia.extract) + '</p>';
      html += '<div class="entity-box-links entity-box-links-main">';
      html += '<a class="entity-box-btn entity-box-btn-wikipedia" href="' + escapeAttr(resumoWikipedia.url) + '" target="_blank" rel="noopener">Ler mais</a>';
      html += '</div>';
      html += '</div>';
    } else if (wikipediaInfo && wikipediaInfo.url) {
      html += '<div class="entity-box-links entity-box-links-main">';
      html += '<a class="entity-box-btn entity-box-btn-wikipedia" href="' + escapeAttr(wikipediaInfo.url) + '" target="_blank" rel="noopener">Ler mais na Wikipédia</a>';
      html += '</div>';
    }

    html += '<div class="entity-box-links entity-box-links-external">';
    html += renderLigacaoAutoridade(autor);
    html += '<a class="entity-box-btn entity-box-btn-small" href="https://www.wikidata.org/wiki/' + escapeAttr(qid) + '" target="_blank" rel="noopener">Wikidata</a>';

    externos.forEach(function (ext) {
      html += '<a class="entity-box-btn entity-box-btn-small" href="' + escapeAttr(ext.url) + '" target="_blank" rel="noopener">' + escapeHtml(ext.label) + '</a>';
    });

    html += '</div>';
    html += '</article>';

    return html;
  }

  function renderLigacaoAutoridade(autor) {
    if (!autor || !autor.authid) return '';

    const href = '/cgi-bin/koha/opac-authoritiesdetail.pl?authid=' +
      encodeURIComponent(autor.authid);

    return '<a class="entity-box-btn entity-box-btn-small entity-box-btn-authority" href="' +
      escapeAttr(href) +
      '">Ver autoridade</a>';
  }

  function construirCartaoSemWikidata(autor) {
    if (!CONFIG.mostrarAutoresSemQID) return '';

    const linkAutoridade = renderLigacaoAutoridade(autor);

    return (
      '<article class="entity-box-card entity-box-card-missing entity-box-card-compact">' +
        '<div class="entity-box-top">' +
          '<div class="entity-box-photo entity-box-photo-empty">' +
            '<span>' + escapeHtml(iniciais(autor.nome)) + '</span>' +
          '</div>' +
          '<div class="entity-box-heading">' +
            '<div class="entity-box-name">' + escapeHtml(autor.nome) + '</div>' +
            renderPapeis(autor.papeis) +
            '<div class="entity-box-empty">' + escapeHtml(CONFIG.mensagemSemQID) + '</div>' +
            (linkAutoridade ? '<div class="entity-box-links entity-box-links-main">' + linkAutoridade + '</div>' : '') +
          '</div>' +
        '</div>' +
      '</article>'
    );
  }

  function renderPapeis(papeis) {
    if (!papeis || !papeis.length) return '';

    return (
      '<div class="entity-box-roles">' +
        papeis.map(function (papel) {
          return '<span>' + escapeHtml(papel) + '</span>';
        }).join('') +
      '</div>'
    );
  }

  function aplicarColapso() {
    const cards = Array.from(document.querySelectorAll('#entity-box-content .entity-box-card'));

    if (cards.length <= CONFIG.maxVisiveis) return;

    cards.forEach(function (card, index) {
      if (index >= CONFIG.maxVisiveis) {
        card.classList.add('entity-box-hidden');
      }
    });

    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'entity-box-toggle-more';
    botao.textContent = 'Ver mais autores (' + (cards.length - CONFIG.maxVisiveis) + ')';

    botao.addEventListener('click', function () {
      const fechado = cards.some(function (card) {
        return card.classList.contains('entity-box-hidden');
      });

      cards.forEach(function (card, index) {
        if (index >= CONFIG.maxVisiveis) {
          card.classList.toggle('entity-box-hidden', !fechado);
        }
      });

      botao.textContent = fechado
        ? 'Ocultar autores'
        : 'Ver mais autores (' + (cards.length - CONFIG.maxVisiveis) + ')';
    });

    document.querySelector('#entity-box-content').appendChild(botao);
  }

  function obterTextoMultilingue(obj) {
    if (!obj) return '';

    for (const lang of CONFIG.langs) {
      if (obj[lang] && obj[lang].value) return obj[lang].value;
    }

    return '';
  }

  function obterDescricaoPT(entidade) {
    if (!entidade.descriptions) return '';
    if (entidade.descriptions.pt && entidade.descriptions.pt.value) return entidade.descriptions.pt.value;
    if (entidade.descriptions['pt-br'] && entidade.descriptions['pt-br'].value) return entidade.descriptions['pt-br'].value;
    if (entidade.descriptions.en && entidade.descriptions.en.value) return entidade.descriptions.en.value;
    return '';
  }

  function obterValorClaim(entidade, prop) {
    try {
      return entidade.claims[prop][0].mainsnak.datavalue.value;
    } catch (e) {
      return null;
    }
  }

  function obterDataClaim(entidade, prop) {
    try {
      const valor = entidade.claims[prop][0].mainsnak.datavalue.value;
      return formatarDataWikidata(valor.time, valor.precision);
    } catch (e) {
      return '';
    }
  }

  function formatarDataWikidata(time, precision) {
    if (!time) return '';

    const match = time.match(/^([+-])(\d{4,})-(\d{2})-(\d{2})/);
    if (!match) return '';

    const sinal = match[1];
    const ano = match[2];
    const mes = match[3];
    const dia = match[4];

    if (sinal === '-') return ano + ' a.C.';
    if (precision >= 11) return dia + '/' + mes + '/' + ano;
    if (precision === 10) return mes + '/' + ano;
    if (precision === 9) return ano;

    return ano;
  }

  function obterEntityIdClaim(entidade, prop) {
    try {
      return entidade.claims[prop][0].mainsnak.datavalue.value.id || '';
    } catch (e) {
      return '';
    }
  }

  function obterEntityIdsClaim(entidade, prop) {
    try {
      return entidade.claims[prop]
        .map(function (c) {
          return c.mainsnak.datavalue.value.id;
        })
        .filter(Boolean);
    } catch (e) {
      return [];
    }
  }

  async function obterLabels(ids) {
    const resultado = {};
    const porBuscar = ids.filter(function (id) {
      return id && !cacheLabels.has(id);
    });

    if (porBuscar.length) {
      try {
        const url =
          'https://www.wikidata.org/w/api.php?action=wbgetentities&ids=' +
          encodeURIComponent(porBuscar.join('|')) +
          '&props=labels&languages=pt|pt-br|en|fr|es&format=json&origin=*';

        const response = await fetch(url);
        const data = await response.json();

        Object.keys(data.entities || {}).forEach(function (id) {
          const entidade = data.entities[id];
          let label = '';

          for (const lang of CONFIG.langs) {
            if (entidade.labels && entidade.labels[lang]) {
              label = entidade.labels[lang].value;
              break;
            }
          }

          cacheLabels.set(id, label || id);
        });
      } catch (e) {
        console.warn('Entity Box: erro ao obter labels', e);
      }
    }

    ids.forEach(function (id) {
      resultado[id] = cacheLabels.get(id) || id;
    });

    return resultado;
  }

  function obterWikipediaInfo(entidade, label) {
    if (entidade && entidade.sitelinks) {
      const prioridades = ['ptwiki', 'enwiki'];

      for (const key of prioridades) {
        if (entidade.sitelinks[key] && entidade.sitelinks[key].title) {
          const lang = key.replace('wiki', '');
          const title = entidade.sitelinks[key].title;

          return {
            lang: lang,
            title: title,
            url: 'https://' + lang + '.wikipedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_'))
          };
        }
      }
    }

    return {
      lang: 'pt',
      title: label,
      url: 'https://pt.wikipedia.org/w/index.php?search=' + encodeURIComponent(label)
    };
  }

  async function obterResumoWikipedia(wikipediaInfo) {
    if (!wikipediaInfo || !wikipediaInfo.lang || !wikipediaInfo.title) return null;

    const key = 'entity_box_' + CONFIG.cacheNamespace + '_wp_' + wikipediaInfo.lang + '_' + wikipediaInfo.title;

    if (cacheWikipedia.has(key)) return cacheWikipedia.get(key);

    const cached = lerSessionCache(key);

    if (cached !== undefined) {
      cacheWikipedia.set(key, cached);
      return cached;
    }

    try {
      const url =
        'https://' +
        encodeURIComponent(wikipediaInfo.lang) +
        '.wikipedia.org/api/rest_v1/page/summary/' +
        encodeURIComponent(wikipediaInfo.title.replace(/ /g, '_'));

      const response = await fetch(url);

      if (!response.ok) {
        cacheWikipedia.set(key, null);
        return null;
      }

      const data = await response.json();

      const extract = limparResumoWikipedia(data.extract || '');
      const finalUrl =
        data.content_urls &&
        data.content_urls.desktop &&
        data.content_urls.desktop.page
          ? data.content_urls.desktop.page
          : wikipediaInfo.url;

      if (!extract) {
        cacheWikipedia.set(key, null);
        return null;
      }

      const resumo = {
        extract: extract,
        url: finalUrl,
        lang: wikipediaInfo.lang
      };

      cacheWikipedia.set(key, resumo);
      gravarSessionCache(key, resumo);

      return resumo;
    } catch (e) {
      console.warn('Entity Box: erro ao obter resumo da Wikipédia', wikipediaInfo, e);
      cacheWikipedia.set(key, null);
      return null;
    }
  }

  function limparResumoWikipedia(texto) {
    const limpo = limparTexto(texto);

    if (!limpo) return '';

    const limite = 420;

    if (limpo.length <= limite) return limpo;

    const cortado = limpo.slice(0, limite);
    const ultimoPonto = cortado.lastIndexOf('.');

    if (ultimoPonto > 180) {
      return cortado.slice(0, ultimoPonto + 1);
    }

    return cortado.replace(/\s+\S*$/, '') + '...';
  }

  function obterIdentificadoresExternos(entidade) {
    const resultado = [];

    CONFIG.externalIds.forEach(function (ext) {
      try {
        const valor = entidade.claims[ext.prop][0].mainsnak.datavalue.value;

        if (valor) {
          resultado.push({
            label: ext.label,
            url: ext.url.replace('$1', encodeURIComponent(valor))
          });
        }
      } catch (e) {}
    });

    return resultado;
  }

  function imagemCommons(filename) {
    const normalizado = String(filename).replace(/ /g, '_');
    return 'https://commons.wikimedia.org/wiki/Special:Redirect/file/' + encodeURIComponent(normalizado);
  }

  function criarCaixa() {
    if (document.querySelector('#entity-box')) return;

    inserirEstilos();

    const html =
      '<aside id="entity-box" aria-label="Autores">' +
        '<div id="entity-box-header">' +
          '<span>' + escapeHtml(CONFIG.titulo) + '</span>' +
          '<span id="entity-box-count"></span>' +
        '</div>' +
        '<div id="entity-box-content"></div>' +
        '<div id="entity-box-source">' + CONFIG.notaFinal + '</div>' +
      '</aside>';

    const alvo =
      document.querySelector('#action') ||
      document.querySelector('.actions-menu') ||
      document.querySelector('#opac-detail-sidebar') ||
      document.querySelector('.col-lg-3') ||
      document.querySelector('.col-md-3') ||
      document.querySelector('#bibliodescriptions') ||
      document.querySelector('#catalogue_detail_biblio') ||
      document.body;

    alvo.insertAdjacentHTML('afterbegin', html);
  }

  function atualizarContador() {
    const cards = document.querySelectorAll('.entity-box-card');
    const count = document.querySelector('#entity-box-count');

    if (count) count.textContent = cards.length ? String(cards.length) : '';
  }

  function inserirEstilos() {
    if (document.querySelector('#entity-box-style')) return;

    const css =
      '<style id="entity-box-style">' +
        '#entity-box {' +
          'background:#ffffff;' +
          'border:1px solid #e5e7eb;' +
          'border-radius:16px;' +
          'box-shadow:0 10px 30px rgba(15,23,42,0.08);' +
          'margin:0 0 16px 0;' +
          'overflow:hidden;' +
          'color:#111827;' +
          'font-size:14px;' +
        '}' +

        '#entity-box-header {' +
          'display:flex;' +
          'justify-content:space-between;' +
          'align-items:center;' +
          'padding:14px 16px 10px 16px;' +
          'font-weight:700;' +
          'font-size:17px;' +
          'letter-spacing:-0.01em;' +
          'border-bottom:1px solid #f1f3f5;' +
          'background:linear-gradient(180deg,#ffffff 0%,#fafafa 100%);' +
        '}' +

        '#entity-box-count {' +
          'display:inline-flex;' +
          'align-items:center;' +
          'justify-content:center;' +
          'min-width:22px;' +
          'height:22px;' +
          'padding:0 7px;' +
          'border-radius:999px;' +
          'background:#f1f5f9;' +
          'color:#64748b;' +
          'font-size:12px;' +
          'font-weight:600;' +
        '}' +

        '#entity-box-content {' +
          'padding:4px 14px 2px 14px;' +
        '}' +

        '.entity-box-card {' +
          'padding:14px 0;' +
          'border-bottom:1px solid #f0f0f0;' +
        '}' +

        '.entity-box-card:last-child {' +
          'border-bottom:none;' +
        '}' +

        '.entity-box-hidden {' +
          'display:none;' +
        '}' +

        '.entity-box-top {' +
          'display:flex;' +
          'gap:12px;' +
          'align-items:flex-start;' +
        '}' +

        '.entity-box-photo {' +
          'flex:0 0 62px;' +
          'width:62px;' +
          'height:78px;' +
          'border-radius:14px;' +
          'overflow:hidden;' +
          'border:1px solid #e5e7eb;' +
          'background:#f8fafc;' +
          'display:flex;' +
          'align-items:center;' +
          'justify-content:center;' +
        '}' +

        '.entity-box-card-main .entity-box-photo {' +
          'flex-basis:118px;' +
          'width:118px;' +
          'height:148px;' +
          'border-radius:20px;' +
        '}' +

        '.entity-box-photo img {' +
          'width:100%;' +
          'height:100%;' +
          'object-fit:cover;' +
          'display:block;' +
        '}' +

        '.entity-box-photo-empty span {' +
          'font-size:20px;' +
          'font-weight:700;' +
          'color:#64748b;' +
        '}' +

        '.entity-box-card-main .entity-box-photo-empty span {' +
          'font-size:32px;' +
        '}' +

        '.entity-box-heading {' +
          'min-width:0;' +
          'flex:1;' +
        '}' +

        '.entity-box-name {' +
          'font-weight:700;' +
          'font-size:16px;' +
          'line-height:1.2;' +
          'margin-bottom:4px;' +
          'letter-spacing:-0.01em;' +
        '}' +

        '.entity-box-card-main .entity-box-name {' +
          'font-size:18px;' +
        '}' +

        '.entity-box-roles {' +
          'display:flex;' +
          'flex-wrap:wrap;' +
          'gap:4px;' +
          'margin:2px 0 7px 0;' +
        '}' +

        '.entity-box-roles span {' +
          'display:inline-flex;' +
          'font-size:11px;' +
          'color:#475569;' +
          'background:#f1f5f9;' +
          'border:1px solid #e2e8f0;' +
          'border-radius:999px;' +
          'padding:2px 8px;' +
          'line-height:1.2;' +
        '}' +

        '.entity-box-desc {' +
          'color:#4b5563;' +
          'line-height:1.35;' +
          'font-size:13px;' +
        '}' +

        '.entity-box-card-compact {' +
          'padding-top:10px;' +
          'padding-bottom:10px;' +
        '}' +

        '.entity-box-card-compact .entity-box-desc {' +
          'font-size:12.5px;' +
        '}' +

        '.entity-box-wikipedia-summary {' +
          'margin-top:12px;' +
          'padding:10px 11px;' +
          'border:1px solid #eef2f7;' +
          'border-radius:12px;' +
          'background:#fbfdff;' +
        '}' +

        '.entity-box-wikipedia-label {' +
          'font-size:11px;' +
          'font-weight:700;' +
          'letter-spacing:0.02em;' +
          'text-transform:uppercase;' +
          'color:#64748b;' +
          'margin-bottom:5px;' +
        '}' +

        '.entity-box-wikipedia-summary p {' +
          'margin:0;' +
          'font-size:12.8px;' +
          'line-height:1.45;' +
          'color:#374151;' +
        '}' +

        '.entity-box-facts {' +
          'margin:12px 0 0 0;' +
          'padding:0;' +
        '}' +

        '.entity-box-card-compact .entity-box-facts {' +
          'margin-top:8px;' +
        '}' +

        '.entity-box-facts div {' +
          'display:grid;' +
          'grid-template-columns:86px 1fr;' +
          'gap:8px;' +
          'padding:5px 0;' +
          'border-top:1px solid #f5f5f5;' +
        '}' +

        '.entity-box-facts dt {' +
          'color:#6b7280;' +
          'font-weight:600;' +
          'font-size:12px;' +
        '}' +

        '.entity-box-facts dd {' +
          'margin:0;' +
          'color:#111827;' +
          'font-size:12.5px;' +
          'line-height:1.35;' +
        '}' +

        '.entity-box-links {' +
          'display:flex;' +
          'flex-wrap:wrap;' +
          'gap:6px;' +
          'margin-top:9px;' +
        '}' +

        '.entity-box-links-external {' +
          'margin-top:6px;' +
        '}' +

        '.entity-box-btn {' +
          'display:inline-flex;' +
          'align-items:center;' +
          'border:1px solid #e5e7eb;' +
          'background:#fafafa;' +
          'border-radius:999px;' +
          'padding:4px 9px;' +
          'font-size:12px;' +
          'line-height:1;' +
          'text-decoration:none !important;' +
          'color:#0369a1;' +
        '}' +

        '.entity-box-btn:hover {' +
          'background:#f0f9ff;' +
          'border-color:#bae6fd;' +
          'text-decoration:none !important;' +
        '}' +

        '.entity-box-btn-small {' +
          'font-size:10.5px;' +
          'padding:2px 7px;' +
          'color:#667085;' +
          'border-color:#edf0f3;' +
          'background:#fbfbfc;' +
        '}' +

        '.entity-box-btn-small:hover {' +
          'color:#0369a1;' +
          'border-color:#dbe3eb;' +
          'background:#f8fafc;' +
        '}' +

        '.entity-box-btn-authority {' +
          'color:#0f172a;' +
          'font-weight:600;' +
          'border-color:#cbd5e1;' +
          'background:#ffffff;' +
        '}' +

        '.entity-box-btn-authority:hover {' +
          'color:#0369a1;' +
          'background:#f0f9ff;' +
          'border-color:#7dd3fc;' +
        '}' +

        '.entity-box-empty {' +
          'color:#6b7280;' +
          'font-size:13px;' +
          'font-style:italic;' +
          'padding:3px 0;' +
        '}' +

        '.entity-box-card-missing {' +
          'opacity:0.9;' +
        '}' +

        '.entity-box-toggle-more {' +
          'width:100%;' +
          'border:1px solid #e5e7eb;' +
          'background:#f8fafc;' +
          'color:#0369a1;' +
          'border-radius:999px;' +
          'padding:7px 10px;' +
          'margin:10px 0 8px 0;' +
          'font-size:12px;' +
          'cursor:pointer;' +
        '}' +

        '.entity-box-toggle-more:hover {' +
          'background:#f0f9ff;' +
          'border-color:#bae6fd;' +
        '}' +

        '#entity-box-source {' +
          'padding:8px 16px 12px 16px;' +
          'color:#9ca3af;' +
          'font-size:10.5px;' +
          'line-height:1.35;' +
          'border-top:1px solid #f3f4f6;' +
          'background:#fcfcfc;' +
        '}' +

        '#entity-box-source strong {' +
          'color:#64748b;' +
          'font-weight:700;' +
        '}' +
      '</style>';

    document.head.insertAdjacentHTML('beforeend', css);
  }

  function lerSessionCache(key) {
    if (!CONFIG.cacheMinutos || CONFIG.cacheMinutos <= 0) return undefined;

    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return undefined;

      const parsed = JSON.parse(raw);

      if (!parsed || !parsed.expires || Date.now() > parsed.expires) {
        sessionStorage.removeItem(key);
        return undefined;
      }

      return parsed.value;
    } catch (e) {
      return undefined;
    }
  }

  function gravarSessionCache(key, value) {
    if (!CONFIG.cacheMinutos || CONFIG.cacheMinutos <= 0) return;

    try {
      sessionStorage.setItem(key, JSON.stringify({
        value: value,
        expires: Date.now() + CONFIG.cacheMinutos * 60 * 1000
      }));
    } catch (e) {}
  }

  function normalizarTexto(texto) {
    return limparTexto(texto)
      .toLowerCase()
      .replace(/:$/, '')
      .trim();
  }

  function iniciais(nome) {
    return String(nome || '')
      .replace(/,\s*\d{4}.*/g, '')
      .replace(/,/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(function (p) {
        return p.charAt(0).toUpperCase();
      })
      .join('');
  }

  function limparTexto(texto) {
    return String(texto || '').replace(/\s+/g, ' ').trim();
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, function (m) {
      return ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      })[m];
    });
  }

  function escapeAttr(str) {
    return escapeHtml(str);
  }

  function escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

})();
