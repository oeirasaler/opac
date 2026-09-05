/* ================================================================================
   OPAC_SUBJECT_RECOMMENDATIONS
   Versão 1.0
   Autor: Miguel Mimoso Correia

   Finalidade
   ----------
   Apresenta recomendações de leitura relacionadas na ficha bibliográfica
   do OPAC, com base nos assuntos UNIMARC do registo atual.

   Fontes de assunto
   -----------------
   - 606 — Nome comum usado como assunto
   - 600 — Nome de pessoa usado como assunto, como fallback

   Estratégia
   ----------
   - privilegia 606 antes de 600;
   - usa os subcampos $a e $x como termos principais;
   - usa $y, $z e $j apenas como refinamento;
   - pondera termos e combinações;
   - agrega resultados repetidos;
   - promove diversidade por autor e título;
   - aplica rotação de resultados para evitar repetições;
   - não expõe ao utilizador os termos de assunto usados internamente;
   - adapta automaticamente os textos ao idioma ativo do OPAC.

   Página-alvo
   -----------
   /cgi-bin/koha/opac-detail.pl

   Instalação
   ----------
   Administração > Preferências do sistema > OPACUserJS

   Inserir apenas o JavaScript, sem tags <script>.
   ================================================================================ */

$(document).ready(function () {

    if (!window.location.href.includes('/cgi-bin/koha/opac-detail.pl')) return;

    $('#opac-subject-recommendations-termos').remove();

    $('#opac-subject-recommendations')
        .find('div')
        .filter(function () {
            var texto = $(this).text().trim().toLowerCase();
            return texto.indexOf('assunto relacionado:') === 0 ||
                   texto.indexOf('related subject:') === 0;
        })
        .remove();

    if ($('#opac-subject-recommendations').length) return;


    if (!document.getElementById('opac-subject-recommendations-styles')) {
        $('<style id="opac-subject-recommendations-styles">' +
            '.opac-subject-recommendations-carousel-card.opac-subject-recommendations-cover-ready{visibility:visible!important;}' +
          '</style>').appendTo('head');
    }

    function obterIdiomaOPAC() {
        var lang = (
            $('html').attr('lang') ||
            $('html').attr('xml:lang') ||
            ''
        ).toLowerCase();

        if (lang.indexOf('en') === 0) return 'en';
        return 'pt';
    }

    var IDIOMA = obterIdiomaOPAC();

    var TEXTOS = {
        pt: {
            titulo: 'Outras propostas de leitura',
            carregar: 'A carregar sugestões...',
            semAssuntos: 'Não foi possível encontrar propostas de leitura relacionadas.',
            semSugestoes: 'Não foram encontradas sugestões relacionadas.',
            erroCarregar: 'Não foi possível carregar sugestões neste momento.'
        },
        en: {
            titulo: 'Other reading suggestions',
            carregar: 'Loading suggestions...',
            semAssuntos: 'No related reading suggestions could be found.',
            semSugestoes: 'No related suggestions were found.',
            erroCarregar: 'Suggestions could not be loaded at this time.'
        }
    };

    var T = TEXTOS[IDIOMA] || TEXTOS.pt;

    var CONFIG = {
        maxCamposMARC: 5,
        maxSementesPesquisa: 4,
        maxResultadosPorPesquisa: 18,
        maxSugestoes: 12,
        larguraCartao: 145,
        larguraCartaoMobile: 128,
        gapCartoes: 14,
subcamposPrincipais: ['a', 'x'],
        subcamposRefinamento: ['y', 'z', 'j'],
        subcamposIgnorados: ['2', '9'],

        pesosSubcampo: {
            a: 7,
            x: 5,
            y: 1.5,
            z: 1.5,
            j: 1
        },

        pesoCombinacao: 2,
        bonusOcorrenciaMultipla: 3,
        maxBonusOcorrencias: 9,

        maxPorAutor: 2,
        maxPorTituloNormalizado: 1,

        offsetsRotativos: [0, 18, 36, 54],
        aleatoriedadeControlada: 0.35,

        timeoutPesquisaMs: 6500,
        debug: false
    };

    function logDebug() {
        if (!CONFIG.debug || !window.console) return;
        console.log.apply(console, arguments);
    }

    function limparTexto(txt) {
        return $.trim(txt || '').replace(/\s+/g, ' ');
    }

    function normalizarChave(txt) {
        return limparTexto(txt)
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[.;,:]+$/g, '')
            .replace(/\s+/g, ' ');
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

    function obterBiblionumberAtual() {
        var match = window.location.href.match(/[?&]biblionumber=(\d+)/);
        return match ? match[1] : '';
    }

    function obterCapa(biblionumber) {
        return '/cgi-bin/koha/opac-image.pl?thumbnail=1&biblionumber=' + encodeURIComponent(biblionumber);
    }

    function criarBlocoBase() {
        return `
            <div id="opac-subject-recommendations" style="clear:both; display:block; width:100%; box-sizing:border-box; margin:28px 0 0 0; padding:20px 18px 24px 18px; border:1px solid #e5e5e5; background:#fff;">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:18px;">
                    <h3 style="margin:0; font-size:18px; font-weight:600;">${escapeHtml(T.titulo)}</h3>
                    <div>
                        <button type="button" id="opac-subject-recommendations-carousel-prev" class="btn btn-default btn-sm" style="margin-right:5px;">‹</button>
                        <button type="button" id="opac-subject-recommendations-carousel-next" class="btn btn-default btn-sm">›</button>
                    </div>
                </div>

                <div id="opac-subject-recommendations-carousel-wrapper" style="overflow:hidden; width:100%; box-sizing:border-box; padding:0 2px 2px 2px;">
                    <div id="opac-subject-recommendations-carousel-track" style="display:flex; gap:14px; transition:transform .25s ease; padding:0 0 4px 0; will-change:transform;">
                        <div style="font-size:14px; color:#666;">${escapeHtml(T.carregar)}</div>
                    </div>
                </div>
            </div>
        `;
    }

    function inserirBloco() {
        /*
         * O OPAC Subject Recommendations deve ser uma CAIXA AUTÓNOMA, irmã do bloco de
         * exemplares, e nunca um elemento inserido dentro dele.
         *
         * No OPAC atual, #opac-detail-tabs contém toda a caixa de
         * Exemplares / Comentários / Imagens, incluindo o total de reservas.
         * Por isso, a primeira opção é inserir o OPAC Subject Recommendations DEPOIS desse
         * contentor completo.
         */

        var bloco = criarBlocoBase();

        var tabs = $('#opac-detail-tabs').first();

        if (tabs.length) {
            tabs.after(bloco);
            return;
        }

        /*
         * Fallback: se não existir #opac-detail-tabs, usar o contentor
         * completo de holdings.
         */
        var holdings = $('#holdings').first();

        if (holdings.length) {
            holdings.after(bloco);
            return;
        }

        /*
         * Fallback para templates antigos: subir da tabela para um contentor
         * estrutural, evitando inserir o OPAC Subject Recommendations dentro da própria tabela.
         */
        var tabela = $('#itemst, table#holdingst').last();

        if (tabela.length) {
            var contentorTabela = tabela.closest('.tab-content, .tab-pane, .table-responsive, #holdings').first();

            if (contentorTabela.length) {
                contentorTabela.after(bloco);
            } else {
                tabela.after(bloco);
            }
            return;
        }

        /*
         * Último fallback: depois do bloco bibliográfico principal.
         */
        var destino = $(
            '#catalogue_detail_biblio, ' +
            '#bibliodescriptions, ' +
            '.bibliodescriptions, ' +
            '#isbdcontents, ' +
            '#views'
        ).first();

        if (destino.length) {
            destino.after(bloco);
        } else {
            $('h1').first().after(bloco);
        }
    }

    function criarCartao(item) {
        return `
            <div class="opac-subject-recommendations-carousel-card" style="flex:0 0 auto; min-width:0; visibility:hidden;">
                <a href="${escapeHtml(item.url)}" style="text-decoration:none; color:inherit;">
                    <div style="width:110px; height:155px; margin:0 auto 8px auto; display:flex; align-items:center; justify-content:center; background:#f3f3f3; border:1px solid #ddd;">
                        <img src="${escapeHtml(item.capa)}" alt="" loading="eager" decoding="async" fetchpriority="high" style="max-width:100%; max-height:100%;">
                    </div>
                    <div style="font-size:13px; line-height:1.25; font-weight:600;">${escapeHtml(item.titulo)}</div>
                    ${item.autor ? `<div style="font-size:12px; color:#666; margin-top:3px; line-height:1.25;">${escapeHtml(item.autor)}</div>` : ''}
                </a>
            </div>
        `;
    }

    /*
     * Mostra cada cartão apenas quando a respetiva capa carregar.
     * Se a imagem falhar, o cartão é removido sem nunca ser mostrado.
     *
     * Desta forma não existe uma fase separada de validação das capas:
     * o próprio <img> usado no cartão faz a validação.
     */
    function ativarCapasDosCartoes() {
        $('.opac-subject-recommendations-carousel-card').each(function () {
            var card = this;
            var img = card.querySelector('img');

            if (!img) {
                card.remove();
                return;
            }

            function mostrar() {
                card.classList.add('opac-subject-recommendations-cover-ready');
            }

            function remover() {
                card.remove();

                if ($('.opac-subject-recommendations-carousel-card').length) {
                    ativarCarrossel();
                }
            }

            if (img.complete) {
                if ((img.naturalWidth || 0) > 10 && (img.naturalHeight || 0) > 10) {
                    mostrar();
                } else {
                    remover();
                }
                return;
            }

            img.addEventListener('load', function () {
                if ((img.naturalWidth || 0) > 10 && (img.naturalHeight || 0) > 10) {
                    mostrar();
                    ativarCarrossel();
                } else {
                    remover();
                }
            }, { once: true });

            img.addEventListener('error', remover, { once: true });
        });
    }

    function calcularPesoSubcampo(subcampo) {
        subcampo = String(subcampo || '').toLowerCase();
        return CONFIG.pesosSubcampo[subcampo] || 1;
    }

    function linhaEhCampo(linha, campo) {
        var t = limparTexto(linha);
        var re = new RegExp('^' + campo + '(\\s|\\$|_|#|\\t|$)');
        return re.test(t);
    }

    function labelDeveSerIgnorado(label) {
        label = limparTexto(label).toLowerCase();

        return (
            label.indexOf('sistema') !== -1 ||
            label.indexOf('source') !== -1 ||
            label.indexOf('fonte') !== -1 ||
            label.indexOf('authority') !== -1 ||
            label.indexOf('autoridade') !== -1 ||
            label.indexOf('record number') !== -1 ||
            label.indexOf('número de registo') !== -1 ||
            label.indexOf('thesaurus') !== -1 ||
            label.indexOf('tesauro') !== -1 ||
            label.indexOf('sipor') !== -1
        );
    }

    function inferirSubcampoPorLabel(label) {
        label = limparTexto(label).toLowerCase();

        var match = label.match(/[$_]([a-z0-9])/i);
        if (match) return match[1].toLowerCase();

        if (label.indexOf('subdivisão de assunto') !== -1 ||
            label.indexOf('subject subdivision') !== -1 ||
            label.indexOf('subdivision') !== -1) {
            return 'x';
        }

        if (label.indexOf('geográfica') !== -1 ||
            label.indexOf('geographic') !== -1) {
            return 'z';
        }

        if (label.indexOf('cronológica') !== -1 ||
            label.indexOf('chronological') !== -1) {
            return 'y';
        }

        if (label.indexOf('forma') !== -1 ||
            label.indexOf('form') !== -1) {
            return 'j';
        }

        if (label.indexOf('assunto') !== -1 ||
            label.indexOf('subject') !== -1 ||
            label.indexOf('nome comum') !== -1 ||
            label.indexOf('topical') !== -1) {
            return 'a';
        }

        return 'a';
    }

    function criarGrupoCampo(campo) {
        return {
            campo: campo,
            subcampos: [],
            principais: [],
            refinamentos: []
        };
    }

    function adicionarSubcampoAoGrupo(grupo, subcampo, valor) {
        subcampo = String(subcampo || '').toLowerCase();
        valor = limparTexto(valor)
            .replace(/\s*--\s*/g, ' ')
            .replace(/[.;,:]+$/g, '');

        if (!valor || valor.length < 3) return;
        if (CONFIG.subcamposIgnorados.indexOf(subcampo) !== -1) return;

        var item = {
            termo: valor,
            subcampo: subcampo,
            campo: grupo.campo,
            peso: calcularPesoSubcampo(subcampo)
        };

        grupo.subcampos.push(item);

        if (CONFIG.subcamposPrincipais.indexOf(subcampo) !== -1) {
            grupo.principais.push(item);
        } else if (CONFIG.subcamposRefinamento.indexOf(subcampo) !== -1) {
            grupo.refinamentos.push(item);
        }
    }

    function extrairSubcamposDeLinha(linha, campo) {
        var grupo = criarGrupoCampo(campo);
        var regex = /[$_]([a-z0-9])\s*([^$_]+)/gi;
        var match;

        while ((match = regex.exec(linha)) !== null) {
            adicionarSubcampoAoGrupo(grupo, match[1], match[2]);
        }

        return grupo.subcampos.length ? grupo : null;
    }

    function normalizarGrupos(grupos) {
        var gruposLimpos = [];

        grupos.forEach(function (grupo) {
            var vistos = {};
            var novo = criarGrupoCampo(grupo.campo);

            grupo.subcampos.forEach(function (item) {
                var chave = item.subcampo + '|' + normalizarChave(item.termo);

                if (vistos[chave]) return;
                vistos[chave] = true;

                adicionarSubcampoAoGrupo(novo, item.subcampo, item.termo);
            });

            if (novo.subcampos.length) {
                gruposLimpos.push(novo);
            }
        });

        return gruposLimpos.slice(0, CONFIG.maxCamposMARC);
    }

    function extrairGruposCampoDeHtml(html, campo) {
        var pagina = $('<div>').html(html);
        var grupos = [];
        var grupoAtivo = null;

        pagina.find('tr').each(function () {
            var tr = $(this);
            var textoLinha = limparTexto(tr.text());

            if (linhaEhCampo(textoLinha, campo)) {
                if (grupoAtivo && grupoAtivo.subcampos.length) {
                    grupos.push(grupoAtivo);
                }

                grupoAtivo = criarGrupoCampo(campo);

                var grupoLinha = extrairSubcamposDeLinha(textoLinha, campo);

                if (grupoLinha && grupoLinha.subcampos.length) {
                    grupos.push(grupoLinha);
                    grupoAtivo = null;
                }

                return;
            }

            if (/^[0-9]{3}(\s|#|_|$)/.test(textoLinha) && !linhaEhCampo(textoLinha, campo)) {
                if (grupoAtivo && grupoAtivo.subcampos.length) {
                    grupos.push(grupoAtivo);
                }

                grupoAtivo = null;
                return;
            }

            if (!grupoAtivo) return;

            var tds = tr.find('td');

            if (tds.length >= 2) {
                var label = limparTexto($(tds[0]).text());
                var valor = limparTexto($(tds[1]).text());

                if (valor && !labelDeveSerIgnorado(label)) {
                    adicionarSubcampoAoGrupo(
                        grupoAtivo,
                        inferirSubcampoPorLabel(label),
                        valor
                    );
                }
            }
        });

        if (grupoAtivo && grupoAtivo.subcampos.length) {
            grupos.push(grupoAtivo);
        }

        return normalizarGrupos(grupos);
    }

    function extrairGruposCampoDeTexto(html, campo) {
        var texto = $('<div>').html(html).text();
        var linhas = String(texto || '').split(/\n|\r/);
        var grupos = [];

        linhas.forEach(function (linha) {
            var limpa = limparTexto(linha);

            if (!linhaEhCampo(limpa, campo)) return;

            var grupoLinha = extrairSubcamposDeLinha(limpa, campo);

            if (grupoLinha && grupoLinha.subcampos.length) {
                grupos.push(grupoLinha);
            }
        });

        return normalizarGrupos(grupos);
    }

    function obterAssuntosVisiveisFallback() {
        var grupos606 = [];
        var grupos600 = [];

        $('.results_summary, tr').each(function () {
            var bloco = $(this);
            var label = limparTexto(
                bloco.find('.label, th, td:first-child').first().text()
            ).replace(/:$/, '').toLowerCase();

            bloco.find('a[href*="opac-search.pl"]').each(function () {
                var txt = limparTexto($(this).text());

                if (!txt || txt.length < 3) return;

                if (
                    label.indexOf('nome comum') !== -1 ||
                    label.indexOf('common name') !== -1 ||
                    label.indexOf('topical') !== -1 ||
                    label.indexOf('subject') !== -1
                ) {
                    var grupo606 = criarGrupoCampo('606');
                    adicionarSubcampoAoGrupo(grupo606, 'a', txt);
                    grupos606.push(grupo606);
                }

                if (
                    label.indexOf('nome pessoal') !== -1 ||
                    label.indexOf('personal name') !== -1 ||
                    label.indexOf('personal') !== -1
                ) {
                    var grupo600 = criarGrupoCampo('600');
                    adicionarSubcampoAoGrupo(grupo600, 'a', txt);
                    grupos600.push(grupo600);
                }
            });
        });

        grupos606 = normalizarGrupos(grupos606);
        grupos600 = normalizarGrupos(grupos600);

        if (grupos606.length) {
            return {
                campo: '606',
                grupos: grupos606
            };
        }

        if (grupos600.length) {
            return {
                campo: '600',
                grupos: grupos600
            };
        }

        return {
            campo: '',
            grupos: []
        };
    }

    function obterUrlMarcPublico() {
        var biblionumber = obterBiblionumberAtual();

        if (!biblionumber) return '';

        return '/cgi-bin/koha/opac-MARCdetail.pl?biblionumber=' + encodeURIComponent(biblionumber);
    }

    function obterAssuntos() {
        /*
         * Caminho rápido:
         * tenta primeiro aproveitar os assuntos que já estão presentes
         * na própria ficha bibliográfica. Isto evita um pedido HTTP
         * adicional ao opac-MARCdetail.pl na maioria dos registos.
         */
        var visiveis = obterAssuntosVisiveisFallback();

        if (visiveis && visiveis.grupos && visiveis.grupos.length) {
            logDebug('Assuntos obtidos diretamente da ficha:', visiveis);
            return $.Deferred().resolve(visiveis).promise();
        }

        /*
         * Fallback:
         * só consulta o MARC público quando a ficha não permite obter
         * assuntos suficientes diretamente do DOM.
         */
        var url = obterUrlMarcPublico();

        if (!url) {
            return $.Deferred().resolve(visiveis).promise();
        }

        return $.get({
            url: url,
            timeout: CONFIG.timeoutPesquisaMs
        })
        .then(function (html) {
            var grupos606 = extrairGruposCampoDeHtml(html, '606');

            if (!grupos606.length) {
                grupos606 = extrairGruposCampoDeTexto(html, '606');
            }

            if (grupos606.length) {
                return {
                    campo: '606',
                    grupos: grupos606
                };
            }

            var grupos600 = extrairGruposCampoDeHtml(html, '600');

            if (!grupos600.length) {
                grupos600 = extrairGruposCampoDeTexto(html, '600');
            }

            if (grupos600.length) {
                return {
                    campo: '600',
                    grupos: grupos600
                };
            }

            return visiveis;
        })
        .catch(function () {
            return visiveis;
        });
    }

    function criarSemente(termo, peso, origem, tipo) {
        termo = limparTexto(termo)
            .replace(/\s*--\s*/g, ' ')
            .replace(/[.;,:]+$/g, '');

        if (!termo || termo.length < 3) return null;

        return {
            termo: termo,
            peso: peso || 1,
            origem: origem || '',
            tipo: tipo || 'simples'
        };
    }

    function construirSementesDePesquisa(grupos) {
        var sementes = [];
        var vistos = {};

        grupos.forEach(function (grupo) {
            var principais = grupo.principais || [];
            var refinamentos = grupo.refinamentos || [];

            principais.forEach(function (principal) {
                sementes.push(criarSemente(
                    principal.termo,
                    principal.peso,
                    grupo.campo + '$' + principal.subcampo,
                    'principal'
                ));
            });

            principais.slice(0, 2).forEach(function (principal) {
                refinamentos.slice(0, 2).forEach(function (ref) {
                    sementes.push(criarSemente(
                        principal.termo + ' ' + ref.termo,
                        principal.peso + ref.peso + CONFIG.pesoCombinacao,
                        grupo.campo + '$' + principal.subcampo + '+$' + ref.subcampo,
                        'combinada'
                    ));
                });
            });

            if (principais.length >= 2) {
                sementes.push(criarSemente(
                    principais[0].termo + ' ' + principais[1].termo,
                    principais[0].peso + principais[1].peso + CONFIG.pesoCombinacao,
                    grupo.campo + '$' + principais[0].subcampo + '+$' + principais[1].subcampo,
                    'combinada-principal'
                ));
            }

            if (!principais.length && refinamentos.length) {
                sementes.push(criarSemente(
                    refinamentos[0].termo,
                    Math.max(0.5, refinamentos[0].peso * 0.5),
                    grupo.campo + '$' + refinamentos[0].subcampo,
                    'fallback-refinamento'
                ));
            }
        });

        sementes = sementes.filter(function (s) {
            return s && s.termo && s.termo.length >= 3;
        });

        sementes.forEach(function (s) {
            var chave = normalizarChave(s.termo);

            if (!vistos[chave]) {
                vistos[chave] = s;
            } else {
                vistos[chave].peso += Math.max(1, s.peso * 0.5);
                vistos[chave].origem += '|' + s.origem;
            }
        });

        sementes = Object.keys(vistos).map(function (k) {
            return vistos[k];
        });

        sementes.sort(function (a, b) {
            return b.peso - a.peso;
        });

        return sementes.slice(0, CONFIG.maxSementesPesquisa);
    }

    function obterOffsetRotativo(semente, indice) {
        var biblionumber = obterBiblionumberAtual();
        var chave = 'opac_subject_recommendations_offset_' + biblionumber + '_' + normalizarChave(semente.termo);
        var atual = parseInt(sessionStorage.getItem(chave) || '-1', 10);

        if (isNaN(atual)) atual = -1;

        var proximo = (atual + 1 + indice) % CONFIG.offsetsRotativos.length;

        sessionStorage.setItem(chave, String(proximo));

        return CONFIG.offsetsRotativos[proximo];
    }

    function criarUrlDetalhe(url) {
        if (!url) return '';

        if (url.indexOf('http') === 0) return url;
        if (url.indexOf('/cgi-bin/koha/') === 0) return url;
        if (url.indexOf('/opac-detail.pl') === 0) return '/cgi-bin/koha' + url;

        return '/cgi-bin/koha/' + url.replace(/^\/+/, '');
    }

    function extrairTituloDoBloco(bloco, link) {
        var titulo = limparTexto(link.text());

        if (titulo.length > 3) return titulo;

        titulo = limparTexto(
            bloco.find('.title, .biblio-title, h2, h3').first().text()
        );

        return titulo;
    }

    function extrairAutorDoBloco(bloco) {
        return limparTexto(
            bloco.find(
                '.author, ' +
                '.byAuthor, ' +
                '.results_summary.author, ' +
                'a[href*="idx=au"], ' +
                'a[href*="idx=Author"], ' +
                'a[href*="q=au"]'
            ).first().text()
        );
    }

    function criarPesquisaPorSemente(semente, indice) {
        var offset = obterOffsetRotativo(semente, indice);

        return '/cgi-bin/koha/opac-search.pl?idx=su&q=' +
            encodeURIComponent(semente.termo) +
            '&count=' +
            encodeURIComponent(CONFIG.maxResultadosPorPesquisa) +
            '&offset=' +
            encodeURIComponent(offset);
    }

    function extrairResultados(htmlPesquisa, semente) {
        var pagina = $('<div>').html(htmlPesquisa);
        var atual = obterBiblionumberAtual();
        var resultados = [];
        var vistosLocal = {};
        var posicao = 0;

        pagina.find('a[href*="opac-detail.pl?biblionumber="]').each(function () {
            var link = $(this);
            var url = link.attr('href') || '';
            var match = url.match(/biblionumber=(\d+)/);

            if (!match) return;

            var biblionumber = match[1];

            if (!biblionumber || biblionumber === atual) return;
            if (vistosLocal[biblionumber]) return;

            var bloco = link.closest('li, tr, .searchresults, .result, .bibliocol, div');
            var titulo = extrairTituloDoBloco(bloco, link);

            if (!titulo || titulo.length < 3) return;

            posicao++;
            vistosLocal[biblionumber] = true;

            var pontosPorPosicao = Math.max(
                0,
                (CONFIG.maxResultadosPorPesquisa - posicao) / 8
            );

            resultados.push({
                biblionumber: biblionumber,
                titulo: titulo,
                autor: extrairAutorDoBloco(bloco),
                url: criarUrlDetalhe(url),
                capa: obterCapa(biblionumber),
                pontos: (semente.peso || 1) + pontosPorPosicao,
                ocorrencias: 1,
                termosOrigem: [semente.termo],
                tiposOrigem: [semente.tipo],
                melhorPosicao: posicao
            });
        });

        return resultados;
    }

    function agregarResultados(listaResultados) {
        var mapa = {};

        listaResultados.forEach(function (item) {
            if (!mapa[item.biblionumber]) {
                mapa[item.biblionumber] = item;
                return;
            }

            mapa[item.biblionumber].pontos += item.pontos + CONFIG.bonusOcorrenciaMultipla;
            mapa[item.biblionumber].ocorrencias += 1;
            mapa[item.biblionumber].melhorPosicao = Math.min(
                mapa[item.biblionumber].melhorPosicao,
                item.melhorPosicao
            );

            item.termosOrigem.forEach(function (termo) {
                if (mapa[item.biblionumber].termosOrigem.indexOf(termo) === -1) {
                    mapa[item.biblionumber].termosOrigem.push(termo);
                }
            });

            item.tiposOrigem.forEach(function (tipo) {
                if (mapa[item.biblionumber].tiposOrigem.indexOf(tipo) === -1) {
                    mapa[item.biblionumber].tiposOrigem.push(tipo);
                }
            });
        });

        return Object.keys(mapa).map(function (k) {
            var item = mapa[k];

            item.pontos += Math.min(
                CONFIG.maxBonusOcorrencias,
                item.ocorrencias * CONFIG.bonusOcorrenciaMultipla
            );

            if (item.tiposOrigem.indexOf('combinada') !== -1 ||
                item.tiposOrigem.indexOf('combinada-principal') !== -1) {
                item.pontos += 2;
            }

            item.pontos += Math.random() * CONFIG.aleatoriedadeControlada;

            return item;
        });
    }

    function selecionarComDiversidade(resultados) {
        var selecionados = [];
        var contagemAutor = {};
        var contagemTitulo = {};

        resultados.sort(function (a, b) {
            if (b.pontos !== a.pontos) return b.pontos - a.pontos;
            return a.melhorPosicao - b.melhorPosicao;
        });

        resultados.forEach(function (item) {
            if (selecionados.length >= CONFIG.maxSugestoes) return;

            var chaveAutor = normalizarChave(item.autor || '');
            var chaveTitulo = normalizarChave(item.titulo || '');

            if (chaveTitulo) {
                contagemTitulo[chaveTitulo] = contagemTitulo[chaveTitulo] || 0;

                if (contagemTitulo[chaveTitulo] >= CONFIG.maxPorTituloNormalizado) {
                    return;
                }
            }

            if (chaveAutor) {
                contagemAutor[chaveAutor] = contagemAutor[chaveAutor] || 0;

                if (contagemAutor[chaveAutor] >= CONFIG.maxPorAutor) {
                    return;
                }
            }

            if (chaveTitulo) contagemTitulo[chaveTitulo]++;
            if (chaveAutor) contagemAutor[chaveAutor]++;

            selecionados.push(item);
        });

        if (selecionados.length < CONFIG.maxSugestoes) {
            resultados.forEach(function (item) {
                if (selecionados.length >= CONFIG.maxSugestoes) return;

                var jaExiste = selecionados.some(function (s) {
                    return s.biblionumber === item.biblionumber;
                });

                if (!jaExiste) {
                    selecionados.push(item);
                }
            });
        }

        return selecionados;
    }

    function carregarSugestoes() {
        obterAssuntos().then(function (dados) {
            var grupos = dados.grupos || [];
            var sementes = construirSementesDePesquisa(grupos);

            logDebug('Grupos MARC usados:', grupos);
            logDebug('Sementes de pesquisa:', sementes);

            if (!sementes.length) {
                $('#opac-subject-recommendations-carousel-track').html(
                    '<div style="font-size:14px; color:#666;">' + escapeHtml(T.semAssuntos) + '</div>'
                );
                return;
            }

            var pedidos = sementes.map(function (semente, indice) {
                return $.get({
                    url: criarPesquisaPorSemente(semente, indice),
                    timeout: CONFIG.timeoutPesquisaMs
                });
            });

            $.when.apply($, pedidos).done(function () {
                var todosResultados = [];

                if (pedidos.length === 1) {
                    todosResultados = todosResultados.concat(
                        extrairResultados(arguments[0], sementes[0])
                    );
                } else {
                    $.each(arguments, function (i, resposta) {
                        todosResultados = todosResultados.concat(
                            extrairResultados(resposta[0], sementes[i])
                        );
                    });
                }

                var resultadosAgregados = agregarResultados(todosResultados);

                /*
                 * Primeiro ordena um conjunto alargado de candidatos.
                 * Só depois valida as capas e aplica a seleção final,
                 * para não perder sugestões válidas apenas porque uma
                 * das primeiras posições não tinha imagem.
                 */
                resultadosAgregados.sort(function (a, b) {
                    if (b.pontos !== a.pontos) return b.pontos - a.pontos;
                    return a.melhorPosicao - b.melhorPosicao;
                });

                /*
                 * Seleciona imediatamente os melhores candidatos e constrói
                 * os cartões sem uma fase prévia de validação de imagens.
                 */
                var candidatos = selecionarComDiversidade(resultadosAgregados.slice());

                logDebug('Resultados agregados:', resultadosAgregados);
                logDebug('Resultados selecionados:', candidatos);

                if (!candidatos.length) {
                    $('#opac-subject-recommendations-carousel-track').html(
                        '<div style="font-size:14px; color:#666;">' +
                        escapeHtml(T.semSugestoes) +
                        '</div>'
                    );
                    return;
                }

                var html = '';

                $.each(candidatos, function (_, item) {
                    html += criarCartao(item);
                });

                $('#opac-subject-recommendations-carousel-track').html(html);

                /*
                 * O cartão permanece invisível até a capa confirmar load.
                 * Se não houver capa, é removido.
                 */
                ativarCapasDosCartoes();
                ativarCarrossel();

            }).fail(function () {
                $('#opac-subject-recommendations-carousel-track').html(
                    '<div style="font-size:14px; color:#666;">' + escapeHtml(T.erroCarregar) + '</div>'
                );
            });
        });
    }

    function ativarCarrossel() {
        var posicao = 0;
        var larguraPasso = 0;
        var totalVisiveis = 1;
        var resizeTimer = null;

        var $wrapper = $('#opac-subject-recommendations-carousel-wrapper');
        var $track = $('#opac-subject-recommendations-carousel-track');

        function obterNumeroVisiveis(largura) {
            var viewport = window.innerWidth || document.documentElement.clientWidth || largura;

            /*
             * Mobile:
             * - ecrãs muito estreitos: 1 cartão
             * - restantes smartphones: 2 cartões
             *
             * Tablet:
             * - 3 ou 4 cartões, consoante a largura disponível
             *
             * Desktop:
             * - número inteiro calculado a partir da largura base
             */
            if (viewport < 360) return 1;
            if (viewport < 600) return 2;
            if (viewport < 820) return Math.min(3, Math.max(1, Math.floor((largura + CONFIG.gapCartoes) / (CONFIG.larguraCartaoMobile + CONFIG.gapCartoes))));
            if (viewport < 1024) return Math.min(4, Math.max(1, Math.floor((largura + CONFIG.gapCartoes) / (CONFIG.larguraCartao + CONFIG.gapCartoes))));

            return Math.max(
                1,
                Math.floor((largura + CONFIG.gapCartoes) / (CONFIG.larguraCartao + CONFIG.gapCartoes))
            );
        }

        function medir() {
            var larguraWrapper = Math.floor($wrapper.innerWidth() || 0);
            var total = $('.opac-subject-recommendations-carousel-card').length;

            if (!larguraWrapper || !total) return;

            totalVisiveis = Math.min(total, obterNumeroVisiveis(larguraWrapper));

            var espacoGaps = CONFIG.gapCartoes * Math.max(0, totalVisiveis - 1);
            var larguraCartao = Math.floor((larguraWrapper - espacoGaps) / totalVisiveis);

            /*
             * O último cartão termina sempre dentro do wrapper.
             * O pixel residual fica livre à direita em vez de mostrar
             * parcialmente o cartão seguinte.
             */
            larguraPasso = larguraCartao + CONFIG.gapCartoes;

            $('.opac-subject-recommendations-carousel-card').css({
                'flex': '0 0 ' + larguraCartao + 'px',
                'width': larguraCartao + 'px',
                'max-width': larguraCartao + 'px'
            });

            $track.css({
                'gap': CONFIG.gapCartoes + 'px'
            });

            var max = Math.max(0, total - totalVisiveis);
            if (posicao > max) posicao = max;

            atualizar();
        }

        function atualizar() {
            $track.css(
                'transform',
                'translate3d(' + (-posicao * larguraPasso) + 'px,0,0)'
            );
        }

        $('#opac-subject-recommendations-carousel-next')
            .off('.opacSubjectRecommendations')
            .on('click.opacSubjectRecommendations', function () {
                var total = $('.opac-subject-recommendations-carousel-card').length;
                var max = Math.max(0, total - totalVisiveis);

                if (posicao < max) {
                    posicao++;
                    atualizar();
                }
            });

        $('#opac-subject-recommendations-carousel-prev')
            .off('.opacSubjectRecommendations')
            .on('click.opacSubjectRecommendations', function () {
                if (posicao > 0) {
                    posicao--;
                    atualizar();
                }
            });

        $(window)
            .off('resize.opacSubjectRecommendations orientationchange.opacSubjectRecommendations')
            .on('resize.opacSubjectRecommendations orientationchange.opacSubjectRecommendations', function () {
                clearTimeout(resizeTimer);
                resizeTimer = setTimeout(medir, 120);
            });

        medir();
    }

    inserirBloco();
    carregarSugestoes();

});


/*  ===============================================================================================================================
    PROTEÇÃO FINAL
    Remove elementos auxiliares do OPAC Subject Recommendations caso sejam recriados por cache, duplicação de código ou outro script ativo no OPAC.
    =============================================================================================================================== */

(function () {

    function removerAssuntoRelacionado() {
        $('#opac-subject-recommendations-termos').remove();

        $('#opac-subject-recommendations')
            .find('div')
            .filter(function () {
                var texto = $(this).text().trim().toLowerCase();
                return texto.indexOf('assunto relacionado:') === 0 ||
                       texto.indexOf('related subject:') === 0;
            })
            .remove();
    }

    $(document).ready(function () {
        removerAssuntoRelacionado();

        setTimeout(removerAssuntoRelacionado, 300);
        setTimeout(removerAssuntoRelacionado, 1000);
        setTimeout(removerAssuntoRelacionado, 2000);

        if (!document.body) return;

        var observer = new MutationObserver(function () {
            removerAssuntoRelacionado();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    });

})();
