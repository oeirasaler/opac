/* ========================================================== 
   Authority BOX / OPAC
   Miguel Mimoso Correia CC-BY-NC-SA
   Infobox de autores com Wikidata e Wikipédia.
   ========================================================== */

(function () {
  'use strict';

  const CONFIG = {
    version: '1.1.1',
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
      'co-autor',
      'autor secundário'
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

  // Inicializar mesmo quando o ficheiro é carregado depois de DOMContentLoaded.
  function arrancarAutoridataBox() {
    setTimeout(function () {
      initAutoridataBox().catch(function (erro) {
        console.error('[Authority BOX] Falha na inicialização:', erro);
      });
    }, 500);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', arrancarAutoridataBox, { once: true });
  } else {
    arrancarAutoridataBox();
  }

  async function initAutoridataBox() {
    if (!location.href.includes('opac-detail.pl')) return;

    const autores = recolherAutores();
    if (!autores.length) {
      console.warn('[Authority BOX] Nenhum autor encontrado no detalhe bibliográfico.');
      return;
    }

    criarCaixa();

    const qidsMostrados = new Set();
    let encontrados = 0;

    for (const autor of autores.slice(0, CONFIG.maxAutoridades)) {
      const qid = autor.authid ? await obterQID(autor.authid) : null;

      if (qid && qidsMostrados.has(qid)) continue;
      if (qid) qidsMostrados.add(qid);

      const html = qid
        ? await construirCartaoComWikidata(qid, autor)
        : construirCartaoSemWikidata(autor);

      if (html) {
        encontrados++;
        document.querySelector('#authoritybox-rbmo-content').insertAdjacentHTML('beforeend', html);
      }
    }

    if (!encontrados) {
      document.querySelector('#authoritybox-rbmo-content').innerHTML =
        '<div class="authoritybox-rbmo-empty">' + escapeHtml(CONFIG.mensagemSemQID) + '</div>';
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

      const links = Array.from(celulas[1].querySelectorAll('a[href*="opac-search.pl"], a[href*="opac-authoritiesdetail.pl"]'));

      links.forEach(function (a) {
        const texto = limparTexto(a.textContent);
        const authid = extrairAuthId(a.href);

        if (!texto) return;

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
        document.querySelectorAll('a[href*="opac-search.pl"], a[href*="opac-authoritiesdetail.pl"]')
      );

      links.forEach(function (a) {
        const texto = limparTexto(a.textContent);
        const authid = extrairAuthId(a.href);

        if (!texto) return;

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

    // Koha pode apresentar a descrição bibliográfica em blocos .results_summary,
    // sem uma tabela e sem identificador de autoridade no URL.
    document.querySelectorAll('.results_summary, dl, .biblio-details').forEach(function (bloco) {
      const texto = limparTexto(bloco.textContent);
      const labelEl = bloco.querySelector('.label, dt, th');
      const label = labelEl ? mapearLabel(labelEl.textContent) : mapearLabel(texto);
      if (!CONFIG.camposValidos.includes(label)) return;
      bloco.querySelectorAll('a[href*="opac-search.pl"], a[href*="opac-authoritiesdetail.pl"]').forEach(function (a) {
        const nome = limparTexto(a.textContent);
        if (!nome) return;
        autores.push({ nome: limparNomeAutor(nome), nomeOriginal: nome,
          href: a.href, authid: extrairAuthId(a.href),
          papeis: extrairPapeisDoTexto(nome, label) });
      });
    });

    return autores.filter(function (a) { return !!a.nome; })
      .filter(function (a, i, arr) {
        return arr.findIndex(function (b) {
          return a.authid && b.authid ? b.authid === a.authid : b.nome === a.nome;
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

    if (t.startsWith('autor secundário')) return 'autor secundário';
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

    if (t.startsWith('autor')) return true;
    if (t.startsWith('co-autor')) return true;
    if (t.startsWith('autor secundário')) return true;

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
      const direto = u.searchParams.get('authid');
      if (direto && /^\d+$/.test(direto)) return direto;
      const q = u.searchParams.get('q') || '';
      if (/^\d+$/.test(q)) return q;
      const indice = u.searchParams.get('idx') || '';
      const match = q.match(/^(?:an|an,ext|authid):?\s*(\d+)$/i);
      if (match) return match[1];
      if (/^an(?:,ext)?$/i.test(indice) && /^\d+$/.test(q)) return q;
      return null; // Uma pesquisa textual por autor não é um authid.
    } catch (e) {
      return null;
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
      console.warn('Autoridata: erro ao obter QID', authid, e);
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

    const key = 'autoridata_' + CONFIG.version + '_wd_' + qid;
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
      console.warn('Autoridata: erro Wikidata', qid, e);
      cacheWikidata.set(qid, null);
      return null;
    }
  }

  async function construirCartaoComWikidata(qid, autor) {
    const entidade = await obterEntidade(qid);
    if (!entidade) return construirCartaoSemWikidata(autor);

    const principal = !document.querySelector('.authoritybox-rbmo-card');

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

    let html = '<article class="authoritybox-rbmo-card ' +
      (principal ? 'authoritybox-rbmo-card-main' : 'authoritybox-rbmo-card-compact') +
      '">';

    html += '<div class="authoritybox-rbmo-top">';

    if (imagem) {
      html +=
        '<div class="authoritybox-rbmo-photo">' +
          '<img src="' + escapeAttr(imagemCommons(imagem)) + '" alt="">' +
        '</div>';
    } else {
      html +=
        '<div class="authoritybox-rbmo-photo authoritybox-rbmo-photo-empty">' +
          '<span>' + escapeHtml(iniciais(label)) + '</span>' +
        '</div>';
    }

    html +=
      '<div class="authoritybox-rbmo-heading">' +
        '<div class="authoritybox-rbmo-name">' + escapeHtml(label) + '</div>' +
        renderPapeis(autor.papeis) +
        (descricao ? '<div class="authoritybox-rbmo-desc">' + escapeHtml(descricao) + '</div>' : '') +
      '</div>' +
    '</div>';

    html += '<dl class="authoritybox-rbmo-facts">';

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
      html += '<div class="authoritybox-rbmo-wikipedia-summary">';
      html += '<div class="authoritybox-rbmo-wikipedia-label">Wikipédia</div>';
      html += '<p>' + escapeHtml(resumoWikipedia.extract) + '</p>';
      html += '<div class="authoritybox-rbmo-links authoritybox-rbmo-links-main">';
      html += '<a class="authoritybox-rbmo-btn authoritybox-rbmo-btn-wikipedia" href="' + escapeAttr(resumoWikipedia.url) + '" target="_blank" rel="noopener">Ler mais</a>';
      html += '</div>';
      html += '</div>';
    } else if (wikipediaInfo && wikipediaInfo.url) {
      html += '<div class="authoritybox-rbmo-links authoritybox-rbmo-links-main">';
      html += '<a class="authoritybox-rbmo-btn authoritybox-rbmo-btn-wikipedia" href="' + escapeAttr(wikipediaInfo.url) + '" target="_blank" rel="noopener">Ler mais na Wikipédia</a>';
      html += '</div>';
    }

    html += '<div class="authoritybox-rbmo-links authoritybox-rbmo-links-external">';
    html += renderLigacaoAutoridade(autor);
    html += '<a class="authoritybox-rbmo-btn authoritybox-rbmo-btn-small" href="https://www.wikidata.org/wiki/' + escapeAttr(qid) + '" target="_blank" rel="noopener">Wikidata</a>';

    externos.forEach(function (ext) {
      html += '<a class="authoritybox-rbmo-btn authoritybox-rbmo-btn-small" href="' + escapeAttr(ext.url) + '" target="_blank" rel="noopener">' + escapeHtml(ext.label) + '</a>';
    });

    html += '</div>';
    html += '</article>';

    return html;
  }

  function renderLigacaoAutoridade(autor) {
    if (!autor || !autor.authid) return '';

    const href = '/cgi-bin/koha/opac-authoritiesdetail.pl?authid=' +
      encodeURIComponent(autor.authid);

    return '<a class="authoritybox-rbmo-btn authoritybox-rbmo-btn-small authoritybox-rbmo-btn-authority" href="' +
      escapeAttr(href) +
      '">Ver autoridade</a>';
  }

  function construirCartaoSemWikidata(autor) {
    if (!CONFIG.mostrarAutoresSemQID) return '';

    const linkAutoridade = renderLigacaoAutoridade(autor);

    return (
      '<article class="authoritybox-rbmo-card authoritybox-rbmo-card-missing authoritybox-rbmo-card-compact">' +
        '<div class="authoritybox-rbmo-top">' +
          '<div class="authoritybox-rbmo-photo authoritybox-rbmo-photo-empty">' +
            '<span>' + escapeHtml(iniciais(autor.nome)) + '</span>' +
          '</div>' +
          '<div class="authoritybox-rbmo-heading">' +
            '<div class="authoritybox-rbmo-name">' + escapeHtml(autor.nome) + '</div>' +
            renderPapeis(autor.papeis) +
            '<div class="authoritybox-rbmo-empty">' + escapeHtml(CONFIG.mensagemSemQID) + '</div>' +
            (linkAutoridade ? '<div class="authoritybox-rbmo-links authoritybox-rbmo-links-main">' + linkAutoridade + '</div>' : '') +
          '</div>' +
        '</div>' +
      '</article>'
    );
  }

  function renderPapeis(papeis) {
    if (!papeis || !papeis.length) return '';

    return (
      '<div class="authoritybox-rbmo-roles">' +
        papeis.map(function (papel) {
          return '<span>' + escapeHtml(papel) + '</span>';
        }).join('') +
      '</div>'
    );
  }

  function aplicarColapso() {
    const cards = Array.from(document.querySelectorAll('#authoritybox-rbmo-content .authoritybox-rbmo-card'));

    if (cards.length <= CONFIG.maxVisiveis) return;

    cards.forEach(function (card, index) {
      if (index >= CONFIG.maxVisiveis) {
        card.classList.add('authoritybox-rbmo-hidden');
      }
    });

    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'authoritybox-rbmo-toggle-more';
    botao.textContent = 'Ver mais autores (' + (cards.length - CONFIG.maxVisiveis) + ')';

    botao.addEventListener('click', function () {
      const fechado = cards.some(function (card) {
        return card.classList.contains('authoritybox-rbmo-hidden');
      });

      cards.forEach(function (card, index) {
        if (index >= CONFIG.maxVisiveis) {
          card.classList.toggle('authoritybox-rbmo-hidden', !fechado);
        }
      });

      botao.textContent = fechado
        ? 'Ocultar autores'
        : 'Ver mais autores (' + (cards.length - CONFIG.maxVisiveis) + ')';
    });

    document.querySelector('#authoritybox-rbmo-content').appendChild(botao);
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
        console.warn('Autoridata: erro ao obter labels', e);
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

    const key = 'autoridata_' + CONFIG.version + '_wp_' + wikipediaInfo.lang + '_' + wikipediaInfo.title;

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
      console.warn('Autoridata: erro ao obter resumo da Wikipédia', wikipediaInfo, e);
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
    if (document.querySelector('#authoritybox-rbmo')) return;

    inserirEstilos();

    const html =
      '<aside id="authoritybox-rbmo" aria-label="Autores">' +
        '<div id="authoritybox-rbmo-header">' +
          '<span>' + escapeHtml(CONFIG.titulo) + '</span>' +
          '<span id="authoritybox-rbmo-count"></span>' +
        '</div>' +
        '<div id="authoritybox-rbmo-content"></div>' +
        '<div id="authoritybox-rbmo-source">' + CONFIG.notaFinal + '</div>' +
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
    const cards = document.querySelectorAll('.authoritybox-rbmo-card');
    const count = document.querySelector('#authoritybox-rbmo-count');

    if (count) count.textContent = cards.length ? String(cards.length) : '';
  }

  function inserirEstilos() {
    if (document.querySelector('#authoritybox-rbmo-style')) return;

    const css =
      '<style id="authoritybox-rbmo-style">' +
        '#authoritybox-rbmo {' +
          'background:#ffffff;' +
          'border:1px solid #e5e7eb;' +
          'border-radius:16px;' +
          'box-shadow:0 10px 30px rgba(15,23,42,0.08);' +
          'margin:0 0 16px 0;' +
          'overflow:hidden;' +
          'color:#111827;' +
          'font-size:14px;' +
        '}' +

        '#authoritybox-rbmo-header {' +
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

        '#authoritybox-rbmo-count {' +
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

        '#authoritybox-rbmo-content {' +
          'padding:4px 14px 2px 14px;' +
        '}' +

        '.authoritybox-rbmo-card {' +
          'padding:14px 0;' +
          'border-bottom:1px solid #f0f0f0;' +
        '}' +

        '.authoritybox-rbmo-card:last-child {' +
          'border-bottom:none;' +
        '}' +

        '.authoritybox-rbmo-hidden {' +
          'display:none;' +
        '}' +

        '.authoritybox-rbmo-top {' +
          'display:flex;' +
          'gap:12px;' +
          'align-items:flex-start;' +
        '}' +

        '.authoritybox-rbmo-photo {' +
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

        '.authoritybox-rbmo-card-main .authoritybox-rbmo-photo {' +
          'flex-basis:118px;' +
          'width:118px;' +
          'height:148px;' +
          'border-radius:20px;' +
        '}' +

        '.authoritybox-rbmo-photo img {' +
          'width:100%;' +
          'height:100%;' +
          'object-fit:cover;' +
          'display:block;' +
        '}' +

        '.authoritybox-rbmo-photo-empty span {' +
          'font-size:20px;' +
          'font-weight:700;' +
          'color:#64748b;' +
        '}' +

        '.authoritybox-rbmo-card-main .authoritybox-rbmo-photo-empty span {' +
          'font-size:32px;' +
        '}' +

        '.authoritybox-rbmo-heading {' +
          'min-width:0;' +
          'flex:1;' +
        '}' +

        '.authoritybox-rbmo-name {' +
          'font-weight:700;' +
          'font-size:16px;' +
          'line-height:1.2;' +
          'margin-bottom:4px;' +
          'letter-spacing:-0.01em;' +
        '}' +

        '.authoritybox-rbmo-card-main .authoritybox-rbmo-name {' +
          'font-size:18px;' +
        '}' +

        '.authoritybox-rbmo-roles {' +
          'display:flex;' +
          'flex-wrap:wrap;' +
          'gap:4px;' +
          'margin:2px 0 7px 0;' +
        '}' +

        '.authoritybox-rbmo-roles span {' +
          'display:inline-flex;' +
          'font-size:11px;' +
          'color:#475569;' +
          'background:#f1f5f9;' +
          'border:1px solid #e2e8f0;' +
          'border-radius:999px;' +
          'padding:2px 8px;' +
          'line-height:1.2;' +
        '}' +

        '.authoritybox-rbmo-desc {' +
          'color:#4b5563;' +
          'line-height:1.35;' +
          'font-size:13px;' +
        '}' +

        '.authoritybox-rbmo-card-compact {' +
          'padding-top:10px;' +
          'padding-bottom:10px;' +
        '}' +

        '.authoritybox-rbmo-card-compact .authoritybox-rbmo-desc {' +
          'font-size:12.5px;' +
        '}' +

        '.authoritybox-rbmo-wikipedia-summary {' +
          'margin-top:12px;' +
          'padding:10px 11px;' +
          'border:1px solid #eef2f7;' +
          'border-radius:12px;' +
          'background:#fbfdff;' +
        '}' +

        '.authoritybox-rbmo-wikipedia-label {' +
          'font-size:11px;' +
          'font-weight:700;' +
          'letter-spacing:0.02em;' +
          'text-transform:uppercase;' +
          'color:#64748b;' +
          'margin-bottom:5px;' +
        '}' +

        '.authoritybox-rbmo-wikipedia-summary p {' +
          'margin:0;' +
          'font-size:12.8px;' +
          'line-height:1.45;' +
          'color:#374151;' +
        '}' +

        '.authoritybox-rbmo-facts {' +
          'margin:12px 0 0 0;' +
          'padding:0;' +
        '}' +

        '.authoritybox-rbmo-card-compact .authoritybox-rbmo-facts {' +
          'margin-top:8px;' +
        '}' +

        '.authoritybox-rbmo-facts div {' +
          'display:grid;' +
          'grid-template-columns:86px 1fr;' +
          'gap:8px;' +
          'padding:5px 0;' +
          'border-top:1px solid #f5f5f5;' +
        '}' +

        '.authoritybox-rbmo-facts dt {' +
          'color:#6b7280;' +
          'font-weight:600;' +
          'font-size:12px;' +
        '}' +

        '.authoritybox-rbmo-facts dd {' +
          'margin:0;' +
          'color:#111827;' +
          'font-size:12.5px;' +
          'line-height:1.35;' +
        '}' +

        '.authoritybox-rbmo-links {' +
          'display:flex;' +
          'flex-wrap:wrap;' +
          'gap:6px;' +
          'margin-top:9px;' +
        '}' +

        '.authoritybox-rbmo-links-external {' +
          'margin-top:6px;' +
        '}' +

        '.authoritybox-rbmo-btn {' +
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

        '.authoritybox-rbmo-btn:hover {' +
          'background:#f0f9ff;' +
          'border-color:#bae6fd;' +
          'text-decoration:none !important;' +
        '}' +

        '.authoritybox-rbmo-btn-small {' +
          'font-size:10.5px;' +
          'padding:2px 7px;' +
          'color:#667085;' +
          'border-color:#edf0f3;' +
          'background:#fbfbfc;' +
        '}' +

        '.authoritybox-rbmo-btn-small:hover {' +
          'color:#0369a1;' +
          'border-color:#dbe3eb;' +
          'background:#f8fafc;' +
        '}' +

        '.authoritybox-rbmo-btn-authority {' +
          'color:#0f172a;' +
          'font-weight:600;' +
          'border-color:#cbd5e1;' +
          'background:#ffffff;' +
        '}' +

        '.authoritybox-rbmo-btn-authority:hover {' +
          'color:#0369a1;' +
          'background:#f0f9ff;' +
          'border-color:#7dd3fc;' +
        '}' +

        '.authoritybox-rbmo-empty {' +
          'color:#6b7280;' +
          'font-size:13px;' +
          'font-style:italic;' +
          'padding:3px 0;' +
        '}' +

        '.authoritybox-rbmo-card-missing {' +
          'opacity:0.9;' +
        '}' +

        '.authoritybox-rbmo-toggle-more {' +
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

        '.authoritybox-rbmo-toggle-more:hover {' +
          'background:#f0f9ff;' +
          'border-color:#bae6fd;' +
        '}' +

        '#authoritybox-rbmo-source {' +
          'padding:8px 16px 12px 16px;' +
          'color:#9ca3af;' +
          'font-size:10.5px;' +
          'line-height:1.35;' +
          'border-top:1px solid #f3f4f6;' +
          'background:#fcfcfc;' +
        '}' +

        '#authoritybox-rbmo-source strong {' +
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

/* ==========================================================
   Authority BOX / Página da autoridade OPAC
   Extensão autónoma para opac-authoritiesdetail.pl
   Mantém a caixa do registo bibliográfico e acrescenta ficha
   enriquecida na página pública da autoridade.
   ========================================================== */

(function () {
  'use strict';

  const ENTITY_CONFIG = {
    version: '1.0-authority-page',
    titulo: 'Ficha da autoridade',
    notaFinal: '<strong>Fontes:</strong> autoridade local Koha, Wikidata e Wikipédia.<br>Ligação semântica estabelecida através do registo de autoridade local.',
    mensagemSemQID: 'Esta autoridade ainda não tem ligação Wikidata registada.',
    langs: ['pt', 'pt-br', 'en', 'fr', 'es'],
    cacheMinutos: 15,
    externalIds: [
      { prop: 'P214', label: 'VIAF', url: 'https://viaf.org/viaf/$1' },
      { prop: 'P213', label: 'ISNI', url: 'https://isni.org/isni/$1' },
      { prop: 'P244', label: 'LoC', url: 'https://id.loc.gov/authorities/names/$1' },
      { prop: 'P268', label: 'BnF', url: 'https://catalogue.bnf.fr/ark:/12148/cb$1' },
      { prop: 'P227', label: 'GND', url: 'https://d-nb.info/gnd/$1' }
    ]
  };

  const entityCache = new Map();
  const wikiCache = new Map();

  function arrancarAuthorityEntityBox() {
    if (!window.location.pathname.includes('/cgi-bin/koha/opac-authoritiesdetail.pl')) return;
    setTimeout(initAuthorityEntityBox, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', arrancarAuthorityEntityBox, { once: true });
  } else {
    arrancarAuthorityEntityBox();
  }

  async function initAuthorityEntityBox() {
    if (document.querySelector('#authority-entity-opac')) return;

    const authid = obterAuthidDaPagina();
    if (!authid) return;

    inserirEstilosEntity();
    const caixa = criarEstruturaBase(authid);
    const alvo = obterAlvoAuthorityPage();
    alvo.insertAdjacentElement('afterbegin', caixa);

    const content = caixa.querySelector('.authority-entity-content');
    content.textContent = 'A carregar dados da autoridade...';

    const paginaAutoridade = await obterPaginaAutoridade(authid);
    const qid = extrairQIDWikidata(paginaAutoridade);
    const nomeLocal = obterNomeLocalDaPagina() || extrairNomeProvavel(paginaAutoridade) || 'Registo de autoridade ' + authid;

    if (!qid) {
      renderSemWikidata(content, authid, nomeLocal);
      return;
    }

    const entidade = await obterEntidade(qid);
    if (!entidade) {
      renderSemWikidata(content, authid, nomeLocal);
      return;
    }

    const wikipediaInfo = obterWikipediaInfo(entidade, obterTextoMultilingue(entidade.labels) || nomeLocal);
    const resumo = wikipediaInfo ? await obterResumoWikipedia(wikipediaInfo) : null;

    renderComWikidata(content, authid, qid, nomeLocal, entidade, resumo, wikipediaInfo);
  }

  function criarEstruturaBase(authid) {
    const aside = document.createElement('aside');
    aside.id = 'authority-entity-opac';
    aside.setAttribute('aria-label', 'Ficha enriquecida da autoridade');

    const header = document.createElement('div');
    header.className = 'authority-entity-header';

    const title = document.createElement('div');
    title.className = 'authority-entity-title';
    title.textContent = ENTITY_CONFIG.titulo;

    const id = document.createElement('div');
    id.className = 'authority-entity-authid';
    id.textContent = 'authid ' + authid;

    header.appendChild(title);
    header.appendChild(id);

    const content = document.createElement('div');
    content.className = 'authority-entity-content';

    const source = document.createElement('div');
    source.className = 'authority-entity-source';
    source.innerHTML = ENTITY_CONFIG.notaFinal;

    aside.appendChild(header);
    aside.appendChild(content);
    aside.appendChild(source);

    return aside;
  }

  function renderSemWikidata(content, authid, nomeLocal) {
    content.textContent = '';

    const top = document.createElement('div');
    top.className = 'authority-entity-top';

    const avatar = document.createElement('div');
    avatar.className = 'authority-entity-photo authority-entity-photo-empty';
    avatar.textContent = iniciais(nomeLocal);

    const body = document.createElement('div');
    body.className = 'authority-entity-main';

    const nome = document.createElement('h2');
    nome.textContent = limparTexto(nomeLocal);

    const desc = document.createElement('p');
    desc.className = 'authority-entity-desc';
    desc.textContent = ENTITY_CONFIG.mensagemSemQID;

    body.appendChild(nome);
    body.appendChild(desc);
    body.appendChild(criarBlocoCatalogo(authid));

    top.appendChild(avatar);
    top.appendChild(body);
    content.appendChild(top);
  }

  function renderComWikidata(content, authid, qid, nomeLocal, entidade, resumo, wikipediaInfo) {
    content.textContent = '';

    const label = obterTextoMultilingue(entidade.labels) || nomeLocal || qid;
    const descricao = obterDescricao(entidade);
    const imagem = obterValorClaim(entidade, 'P18');
    const nascimento = obterDataClaim(entidade, 'P569');
    const morte = obterDataClaim(entidade, 'P570');
    const fundacao = obterDataClaim(entidade, 'P571');
    const externos = obterIdentificadoresExternos(entidade, qid);

    const top = document.createElement('div');
    top.className = 'authority-entity-top';

    const photo = document.createElement('div');
    photo.className = 'authority-entity-photo';

    if (imagem) {
      const img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      img.src = imagemCommons(imagem);
      photo.appendChild(img);
    } else {
      photo.classList.add('authority-entity-photo-empty');
      photo.textContent = iniciais(label);
    }

    const main = document.createElement('div');
    main.className = 'authority-entity-main';

    const h = document.createElement('h2');
    h.textContent = label;
    main.appendChild(h);

    if (descricao) {
      const p = document.createElement('p');
      p.className = 'authority-entity-desc';
      p.textContent = descricao;
      main.appendChild(p);
    }

    const facts = document.createElement('dl');
    facts.className = 'authority-entity-facts';
    if (nascimento) addFact(facts, 'Nascimento', nascimento);
    if (morte) addFact(facts, 'Morte', morte);
    if (fundacao) addFact(facts, 'Fundação', fundacao);
    if (facts.children.length) main.appendChild(facts);

    if (resumo && resumo.extract) {
      const resumoBox = document.createElement('div');
      resumoBox.className = 'authority-entity-summary';
      const labelEl = document.createElement('div');
      labelEl.className = 'authority-entity-mini-title';
      labelEl.textContent = 'Wikipédia';
      const p = document.createElement('p');
      p.textContent = resumo.extract;
      resumoBox.appendChild(labelEl);
      resumoBox.appendChild(p);
      if (resumo.url) {
        const a = criarLinkSeguro(resumo.url, 'Ler mais');
        a.className = 'authority-entity-btn';
        resumoBox.appendChild(a);
      }
      main.appendChild(resumoBox);
    } else if (wikipediaInfo && wikipediaInfo.url) {
      const a = criarLinkSeguro(wikipediaInfo.url, 'Ler mais na Wikipédia');
      a.className = 'authority-entity-btn';
      main.appendChild(a);
    }

    main.appendChild(criarBlocoCatalogo(authid));
    main.appendChild(criarBlocoIdentificadores(externos));

    top.appendChild(photo);
    top.appendChild(main);
    content.appendChild(top);
  }

  function criarBlocoCatalogo(authid) {
    const box = document.createElement('div');
    box.className = 'authority-entity-catalogue';

    const title = document.createElement('div');
    title.className = 'authority-entity-mini-title';
    title.textContent = 'No catálogo';

    const p = document.createElement('p');
    p.textContent = 'Registos bibliográficos associados a esta autoridade no catálogo.';

    const a = document.createElement('a');
    a.href = '/cgi-bin/koha/opac-search.pl?idx=an,ext&q=' + encodeURIComponent(authid);
    a.className = 'authority-entity-btn authority-entity-btn-primary';
    a.textContent = 'Ver títulos associados';

    box.appendChild(title);
    box.appendChild(p);
    box.appendChild(a);
    return box;
  }

  function criarBlocoIdentificadores(externos) {
    const box = document.createElement('div');
    box.className = 'authority-entity-identifiers';

    const title = document.createElement('div');
    title.className = 'authority-entity-mini-title';
    title.textContent = 'Identificadores';
    box.appendChild(title);

    const links = document.createElement('div');
    links.className = 'authority-entity-id-links';

    externos.forEach(function (ext) {
      const a = criarLinkSeguro(ext.url, ext.label);
      a.className = 'authority-entity-id';
      links.appendChild(a);
    });

    box.appendChild(links);
    return box;
  }

  function addFact(dl, label, value) {
    const wrap = document.createElement('div');
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = label;
    dd.textContent = value;
    wrap.appendChild(dt);
    wrap.appendChild(dd);
    dl.appendChild(wrap);
  }

  function obterAlvoAuthorityPage() {
    return (
      document.querySelector('#maincontent') ||
      document.querySelector('main') ||
      document.querySelector('.main') ||
      document.querySelector('#content') ||
      document.body
    );
  }

  function obterAuthidDaPagina() {
    try {
      const u = new URL(window.location.href);
      const authid = u.searchParams.get('authid') || '';
      return /^\d+$/.test(authid) ? authid : '';
    } catch (e) {
      return '';
    }
  }

  async function obterPaginaAutoridade(authid) {
    try {
      const url = '/cgi-bin/koha/opac-authoritiesdetail.pl?authid=' + encodeURIComponent(authid) + '&marc=1';
      const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) return '';
      return await response.text();
    } catch (e) {
      return '';
    }
  }

  async function obterEntidade(qid) {
    if (!/^Q[1-9][0-9]*$/.test(qid)) return null;
    if (entityCache.has(qid)) return entityCache.get(qid);

    try {
      const url = 'https://www.wikidata.org/wiki/Special:EntityData/' + encodeURIComponent(qid) + '.json';
      const response = await fetch(url);
      if (!response.ok) return null;
      const data = await response.json();
      const entidade = data.entities && data.entities[qid] ? data.entities[qid] : null;
      entityCache.set(qid, entidade && !entidade.missing ? entidade : null);
      return entityCache.get(qid);
    } catch (e) {
      entityCache.set(qid, null);
      return null;
    }
  }

  function extrairQIDWikidata(html) {
    const texto = String(html || '').replace(/\s+/g, ' ');
    const matches = Array.from(texto.matchAll(/Q[1-9][0-9]*/g));

    for (const match of matches) {
      const pos = match.index || 0;
      const contexto = texto.slice(Math.max(0, pos - 500), pos + 500).toLowerCase();
      if (contexto.includes('wikidata')) return match[0];
    }
    return null;
  }

  function extrairNomeProvavel(html) {
    const texto = String(html || '').replace(/\s+/g, ' ');
    const m200a = texto.match(/(?:^|\D)200\s*\$a\s*([^$<]{2,80})/i);
    const m200b = texto.match(/(?:^|\D)200[^<]{0,300}\$b\s*([^$<]{2,80})/i);
    if (m200a) return limparTexto(m200a[1] + (m200b ? ', ' + m200b[1] : ''));
    return '';
  }

  function obterNomeLocalDaPagina() {
    const candidatos = [
      document.querySelector('h1'),
      document.querySelector('.authorityheading'),
      document.querySelector('#authdescriptions'),
      document.querySelector('#userauthdetails')
    ].filter(Boolean);

    for (const el of candidatos) {
      const t = limparTexto(el.textContent);
      if (t && !/detalhes|autoridade|registo/i.test(t)) return t;
    }

    const title = limparTexto(document.title || '').replace(/\|.*$/, '').trim();
    if (title && !/autoridade|opac/i.test(title)) return title;
    return '';
  }

  function obterTextoMultilingue(obj) {
    if (!obj) return '';
    for (const lang of ENTITY_CONFIG.langs) {
      if (obj[lang] && obj[lang].value) return obj[lang].value;
    }
    return '';
  }

  function obterDescricao(entidade) {
    return obterTextoMultilingue(entidade && entidade.descriptions ? entidade.descriptions : null);
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
    const match = String(time || '').match(/^([+-])(\d{4,})-(\d{2})-(\d{2})/);
    if (!match) return '';
    const sinal = match[1];
    const ano = match[2];
    const mes = match[3];
    const dia = match[4];
    if (sinal === '-') return ano + ' a.C.';
    if (precision >= 11) return dia + '/' + mes + '/' + ano;
    if (precision === 10) return mes + '/' + ano;
    return ano;
  }

  function obterIdentificadoresExternos(entidade, qid) {
    const resultado = [];

    ENTITY_CONFIG.externalIds.forEach(function (ext) {
      try {
        const valor = entidade.claims[ext.prop][0].mainsnak.datavalue.value;
        if (valor) resultado.push({ label: ext.label, url: ext.url.replace('$1', encodeURIComponent(valor)) });
      } catch (e) {}
    });

    resultado.push({ label: 'Wikidata', url: 'https://www.wikidata.org/wiki/' + encodeURIComponent(qid) });
    return resultado;
  }

  function obterWikipediaInfo(entidade, label) {
    if (entidade && entidade.sitelinks) {
      for (const key of ['ptwiki', 'enwiki']) {
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
    return label ? {
      lang: 'pt',
      title: label,
      url: 'https://pt.wikipedia.org/w/index.php?search=' + encodeURIComponent(label)
    } : null;
  }

  async function obterResumoWikipedia(wikipediaInfo) {
    if (!wikipediaInfo || !wikipediaInfo.lang || !wikipediaInfo.title) return null;
    const key = wikipediaInfo.lang + ':' + wikipediaInfo.title;
    if (wikiCache.has(key)) return wikiCache.get(key);

    try {
      const url = 'https://' + encodeURIComponent(wikipediaInfo.lang) + '.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(wikipediaInfo.title.replace(/ /g, '_'));
      const response = await fetch(url);
      if (!response.ok) return null;
      const data = await response.json();
      const extract = limparResumo(data.extract || '');
      const finalUrl = data.content_urls && data.content_urls.desktop && data.content_urls.desktop.page ? data.content_urls.desktop.page : wikipediaInfo.url;
      const resumo = extract ? { extract: extract, url: finalUrl } : null;
      wikiCache.set(key, resumo);
      return resumo;
    } catch (e) {
      wikiCache.set(key, null);
      return null;
    }
  }

  function limparResumo(texto) {
    const limpo = limparTexto(texto);
    if (limpo.length <= 420) return limpo;
    const cortado = limpo.slice(0, 420);
    const ultimoPonto = cortado.lastIndexOf('.');
    if (ultimoPonto > 180) return cortado.slice(0, ultimoPonto + 1);
    return cortado.replace(/\s+\S*$/, '') + '...';
  }

  function imagemCommons(filename) {
    return 'https://commons.wikimedia.org/wiki/Special:Redirect/file/' + encodeURIComponent(String(filename || '').replace(/ /g, '_'));
  }

  function criarLinkSeguro(url, texto) {
    const a = document.createElement('a');
    a.href = url;
    a.textContent = texto;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  }

  function inserirEstilosEntity() {
    if (document.querySelector('#authority-entity-opac-style')) return;

    const style = document.createElement('style');
    style.id = 'authority-entity-opac-style';
    style.textContent = `
      #authority-entity-opac {
        background:#ffffff;
        border:1px solid #e5e7eb;
        border-radius:18px;
        box-shadow:0 10px 30px rgba(15,23,42,0.08);
        margin:0 0 20px 0;
        overflow:hidden;
        color:#111827;
        font-size:14px;
      }
      .authority-entity-header {
        display:flex;
        justify-content:space-between;
        align-items:center;
        gap:12px;
        padding:15px 18px;
        border-bottom:1px solid #eef2f7;
        background:linear-gradient(180deg,#ffffff 0%,#fafafa 100%);
      }
      .authority-entity-title { font-weight:700; font-size:17px; }
      .authority-entity-authid { color:#64748b; font-size:12px; }
      .authority-entity-content { padding:18px; }
      .authority-entity-top { display:flex; gap:18px; align-items:flex-start; }
      .authority-entity-photo {
        flex:0 0 120px;
        width:120px;
        height:150px;
        border-radius:18px;
        overflow:hidden;
        border:1px solid #e5e7eb;
        background:#f8fafc;
        display:flex;
        align-items:center;
        justify-content:center;
        font-size:34px;
        font-weight:700;
        color:#64748b;
      }
      .authority-entity-photo img { width:100%; height:100%; object-fit:cover; display:block; }
      .authority-entity-main { min-width:0; flex:1; }
      .authority-entity-main h2 { margin:0 0 6px 0; font-size:25px; line-height:1.15; }
      .authority-entity-desc { margin:0 0 12px 0; color:#4b5563; font-size:14px; line-height:1.45; }
      .authority-entity-facts { margin:10px 0 12px 0; padding:0; }
      .authority-entity-facts div { display:grid; grid-template-columns:90px 1fr; gap:8px; padding:4px 0; border-top:1px solid #f3f4f6; }
      .authority-entity-facts dt { color:#6b7280; font-weight:600; font-size:12px; }
      .authority-entity-facts dd { margin:0; color:#111827; font-size:13px; }
      .authority-entity-summary,
      .authority-entity-catalogue,
      .authority-entity-identifiers {
        margin-top:12px;
        padding:11px 12px;
        border:1px solid #eef2f7;
        border-radius:13px;
        background:#fbfdff;
      }
      .authority-entity-summary p,
      .authority-entity-catalogue p { margin:0 0 8px 0; color:#374151; font-size:13px; line-height:1.45; }
      .authority-entity-mini-title {
        font-size:11px;
        font-weight:700;
        text-transform:uppercase;
        letter-spacing:0.03em;
        color:#64748b;
        margin-bottom:6px;
      }
      .authority-entity-btn,
      .authority-entity-id {
        display:inline-flex;
        align-items:center;
        border:1px solid #e5e7eb;
        background:#fafafa;
        border-radius:999px;
        padding:5px 10px;
        font-size:12px;
        line-height:1;
        text-decoration:none !important;
        color:#0369a1;
        margin-right:6px;
        margin-bottom:6px;
      }
      .authority-entity-btn-primary { background:#f0f9ff; border-color:#bae6fd; }
      .authority-entity-id-links { display:flex; flex-wrap:wrap; gap:6px; }
      .authority-entity-source {
        padding:9px 18px 13px 18px;
        color:#9ca3af;
        font-size:10.5px;
        line-height:1.35;
        border-top:1px solid #f3f4f6;
        background:#fcfcfc;
      }
      .authority-entity-source strong { color:#64748b; }
      @media (max-width: 700px) {
        .authority-entity-top { flex-direction:column; }
        .authority-entity-photo { width:96px; height:120px; flex-basis:auto; }
      }
    `;
    document.head.appendChild(style);
  }

  function iniciais(nome) {
    return String(nome || '')
      .replace(/,\s*\d{4}.*/g, '')
      .replace(/,/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(function (p) { return p.charAt(0).toUpperCase(); })
      .join('');
  }

  function limparTexto(texto) {
    return String(texto || '').replace(/\s+/g, ' ').trim();
  }
})();
