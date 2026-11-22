(() => {
  'use strict';

  const price = (rate_bps, amount_minor = 0) => ({rate_bps, amount_minor});
  const both = (rate, amount) => ({pix: price(rate, amount), card: price(rate, amount)});
  const installments = (base, fixed, additions) => Object.fromEntries(
    additions.map((rate, index) => [String(index + 2), price(base + rate, fixed)])
  );
  const cartpanda = {pix: price(349), card: price(749)};
  const yampi = {pix: price(329), card: price(719, 100)};
  const catalog = {
    kiwify: {
      sources: [
        ['Tarifas Kiwify', 'https://ajuda.kiwify.com.br/pt-br/article/quais-sao-as-taxas-da-plataforma-1ems3wq/'],
        ['Parcelamento Kiwify', 'https://ajuda.kiwify.com.br/pt-br/article/como-funciona-o-parcelamento-no-checkout-1um5p52/']
      ],
      note: 'Tarifa por venda. No parcelamento padrão, o comprador paga os juros.',
      options: [['Padrão Brasil', both(899, 249)]]
    },
    hotmart: {
      sources: [['Política de pagamentos Hotmart', 'https://hotmart.com/pt-br/legal/politicas-de-pagamento']],
      note: 'Vendas nacionais em reais. A faixa até R$ 10,00 usa 20%. Confira adicionais como Player e antecipação no seu contrato.',
      options: [['Padrão Hotpay Brasil', {...both(990, 249), tiers: [{min_minor: 0, max_minor: 1000, ...both(2000, 0)}]}]]
    },
    perfectpay: {
      sources: [['Tarifas Perfect Pay', 'https://help.perfectpay.com.br/article/121-em-quanto-tempo-posso-sacar-minhas-comissoes']],
      note: 'O percentual depende do faturamento acumulado. Confira sua faixa em Financeiro → Taxas e Tarifas.',
      options: [
        ['Até R$ 100 mil acumulados', both(990, 100)],
        ['Acima de R$ 100 mil', both(790, 100)],
        ['Acima de R$ 1 milhão', both(690, 100)],
        ['Acima de R$ 10 milhões', both(590, 100)],
        ['Acima de R$ 25 milhões', both(540, 100)],
        ['Acima de R$ 50 milhões', both(450, 100)]
      ]
    },
    cartpanda: {
      sources: [
        ['Planos Cartpanda', 'https://help.cartpanda.com/pt-br/article/planos-e-taxas-da-plataforma-17hkair/'],
        ['Tarifas Cartpanda Pay', 'https://help.cartpanda.com/pt-br/article/taxas-e-tempo-de-recebimento-cartpanda-pay-1un8j6s/']
      ],
      note: 'O plano de checkout e o gateway cobram separadamente. Selecione a combinação usada na sua loja.',
      options: [
        ['Light · só checkout', both(250, 0)],
        ['Starter · só checkout', both(200, 0)],
        ['Premium · só checkout', both(100, 0)],
        ['Advanced · só checkout', both(50, 0)],
        ['Light + Cartpanda Pay D+14', cartpanda],
        ['Light + Cartpanda Pay D+14 · loja paga os juros', {...cartpanda, installments: installments(749, 0, [724,934,1116,1261,1411,1561,1749,1938,2077,2272,2468])}]
      ]
    },
    kirvano: {
      sources: [['Tarifas Kirvano', 'https://help.kirvano.com/hc/central-de-ajuda/articles/1765385086-minhas-taxas']],
      note: 'O plano padrão tem valores diferentes para pedidos de R$ 1,00 e abaixo de R$ 20,00.',
      options: [['Padrão Brasil', {...both(749, 200), tiers: [
        {min_minor: 100, max_minor: 100, ...both(0, 100)},
        {min_minor: 101, max_minor: 1999, ...both(749, 100)}
      ]}]]
    },
    cakto: {
      sources: [['Tarifas Cakto', 'https://ajuda.cakto.com.br/pt-br/articles/72-quais-sao-as-taxas-da-plataforma-cakto']],
      note: 'Tarifa padrão sem adicional de 3D Secure. Ajuste o cartão se sua operação assumir juros ou adicionais.',
      options: [['Pix e cartão padrão', {pix: price(0, 249), card: price(499, 249)}]]
    },
    yampi: {
      sources: [
        ['Planos Yampi', 'https://www.yampi.com.br/planos'],
        ['Tarifas Yampi Pay', 'https://help.yampi.com.br/pt-BR/articles/8167876-quais-as-taxas-e-o-tempo-de-recebimento-do-yampi-pay'],
        ['Parcelamento Yampi Pay', 'https://help.yampi.com.br/pt-BR/articles/14553291-quais-sao-as-taxas-de-cartao-de-credito-no-yampi-pay']
      ],
      note: 'A tarifa do plano é separada do meio de pagamento. Escolha Yampi Pay apenas se ele processar os pedidos.',
      options: [
        ['Basic ou Essential · só checkout', both(250, 0)],
        ['Starter · só checkout', both(200, 0)],
        ['Pro · só checkout', both(150, 0)],
        ['Basic + Yampi Pay D+30', yampi],
        ['Basic + Yampi Pay D+30 · loja paga os juros', {...yampi, installments: installments(719, 100, [725,846,948,1126,1284,1423,1545,1651,1743,1821,1887])}]
      ]
    },
    appmax: {
      sources: [['Tarifas Appmax', 'https://blog.appmax.com.br/taxas-da-appmax/']],
      note: 'Tarifa pública sem antecipação adicional. Operações elegíveis podem ter valores negociados.',
      options: [['Padrão D+30', {pix: price(99, 99), card: price(349, 99)}]]
    }
  };

  const decimals = {BRL: 2, USD: 2, EUR: 2, JPY: 0, KWD: 3};
  function number(value, digits) {
    return value == null ? '' : (Number(value) / 10 ** digits).toFixed(digits).replace('.', ',');
  }
  function inputs(key, tariff, currency, label) {
    return `<label>Percentual (%) <span class="sr-only">${label}</span><input name="fee_${key}_rate" inputmode="decimal" placeholder="0,00" value="${number(tariff?.rate_bps, 2)}"></label>
      <label>Fixo por venda (${currency}) <span class="sr-only">${label}</span><input name="fee_${key}_fixed" inputmode="decimal" placeholder="0,00" value="${number(tariff?.amount_minor, decimals[currency])}"></label>`;
  }
  function editor(schedule = {}, currency) {
    const count = new Set([...Array.from({length: 12}, (_, index) => index + 1), ...Object.keys(schedule.installments || {}).map(Number)]);
    const tiers = schedule.tiers || [];
    return `<div class="mt-fee-tabs" role="group" aria-label="Meio de pagamento">
        <button type="button" data-fee-tab="pix" aria-pressed="true">Pix</button>
        <button type="button" data-fee-tab="card" aria-pressed="false">Cartão</button>
        <button type="button" data-fee-tab="both" aria-pressed="false">Ambos</button>
      </div>
      <div data-fee-panel="pix" class="mt-fee-panel"><strong class="mt-fee-method" hidden>Pix</strong><div class="mt-fee-inputs">${inputs('pix', schedule.pix, currency, 'Pix')}</div></div>
      <div data-fee-panel="card" class="mt-fee-panel" hidden>
        <strong class="mt-fee-method" hidden>Cartão</strong><div class="mt-fee-inputs">${inputs('card', schedule.card, currency, 'Cartão')}</div>
        <details class="mt-fee-installments">
          <summary>Tarifa por número de parcelas</summary>
          <p class="small">Informe o percentual total para cada número de parcelas. Campos vazios usam a tarifa padrão do cartão.</p>
          <div class="mt-fee-rows">
            ${[...count].map(n => `<div class="mt-fee-installment"><b>${n === 1 ? '1×' : n + '×'}</b><div class="mt-fee-inputs">${inputs('installment_' + n, schedule.installments?.[n], currency, n + ' parcelas')}</div></div>`).join('')}
          </div>
        </details>
      </div>
      ${tiers.length ? `<details class="mt-fee-installments">
        <summary>Tarifas por valor do pedido</summary>
        ${tiers.map((tier, index) => `<div class="mt-fee-tier" data-fee-tier="${index}">
          <div class="mt-fee-inputs">
            <label>De (${currency})<input name="tier_${index}_min" inputmode="decimal" value="${number(tier.min_minor, decimals[currency])}"></label>
            <label>Até (${currency})<input name="tier_${index}_max" inputmode="decimal" value="${number(tier.max_minor, decimals[currency])}"></label>
          </div>
          <span>Pix</span><div class="mt-fee-inputs">${inputs('tier_' + index + '_pix', tier.pix, currency, 'Pix na faixa')}</div>
          <span>Cartão</span><div class="mt-fee-inputs">${inputs('tier_' + index + '_card', tier.card, currency, 'cartão na faixa')}</div>
          <button type="button" class="quiet mt-fee-danger" data-fee-remove-tier>Remover faixa</button>
        </div>`).join('')}
      </details>` : ''}
      <p class="small">Deixe os dois campos de um meio vazios para não aplicar uma tarifa a ele. O valor informado pelo checkout tem prioridade.</p>`;
  }

  function suggestions(provider) {
    if (!Object.hasOwn(catalog, provider)) return '';
    const preset = catalog[provider];
    return `<div class="mt-fee-reference">
      <label>Tarifa de referência
        <select name="fee_reference"><option value="">Personalizada</option>${preset.options.map(([label], index) => `<option value="${index}">${label}</option>`).join('')}</select>
      </label>
      <p class="small">${preset.note}</p>
      <div class="mt-fee-sources">${preset.sources.map(([label, url]) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label} ↗</a>`).join('')}</div>
      <p class="small">Fontes consultadas em 20/11/2026.</p>
    </div>`;
  }
  function fill(host, provider, currency, schedule, withDefault = false) {
    const preset = Object.hasOwn(catalog, provider) ? catalog[provider] : null;
    host.innerHTML = (currency === 'BRL' ? suggestions(provider) : '') + '<div data-fee-editor></div>';
    const select = host.querySelector('[name="fee_reference"]');
    if (select && withDefault && !schedule) select.value = '0';
    host.querySelector('[data-fee-editor]').innerHTML = editor(schedule || (select?.value ? preset.options[Number(select.value)][1] : {}), currency);
    select?.addEventListener('change', () => {
      host.querySelector('[data-fee-editor]').innerHTML = editor(select.value ? preset.options[Number(select.value)][1] : {}, currency);
    });
  }

  function read(form, currency, minorInput) {
    const parse = (name, scale) => minorInput(form.elements[name]?.value.trim(), scale);
    const readPrice = (key, fallback) => {
      const rate = parse('fee_' + key + '_rate', 2);
      const amount = parse('fee_' + key + '_fixed', decimals[currency]);
      if (rate == null && amount == null) return undefined;
      if (rate > 10000) throw new Error('O percentual deve estar entre 0 e 100%.');
      return price(rate ?? fallback?.rate_bps ?? 0, amount ?? fallback?.amount_minor ?? 0);
    };
    const pix = readPrice('pix');
    const card = readPrice('card');
    const overrides = {};
    for (const input of form.querySelectorAll('[name^=fee_installment_][name$=_rate]')) {
      const count = input.name.split('_')[2];
      const tariff = readPrice('installment_' + count, card);
      if (tariff) overrides[count] = tariff;
    }
    if (!pix && !card && !Object.keys(overrides).length) throw new Error('Configure ao menos uma tarifa de Pix ou cartão.');
    const tiers = [...form.querySelectorAll('[data-fee-tier]')].map(row => {
      const key = 'tier_' + row.dataset.feeTier;
      const min_minor = parse(key + '_min', decimals[currency]);
      const max_minor = parse(key + '_max', decimals[currency]);
      const pix = readPrice(key + '_pix');
      const card = readPrice(key + '_card');
      if (min_minor == null || max_minor == null || max_minor < min_minor || (!pix && !card)) throw new Error('Confira as tarifas e os limites da faixa de preço.');
      return {min_minor, max_minor, pix, card};
    }).sort((a, b) => a.min_minor - b.min_minor);
    return {pix, card, installments: overrides, tiers};
  }

  function description(rule, money) {
    const {pix, card, installments: rows} = rule.fee_schedule;
    const format = tariff => {
      const values = [];
      if (tariff.rate_bps || !tariff.amount_minor) values.push(number(tariff.rate_bps, 2) + '%');
      if (tariff.amount_minor) values.push(money(tariff.amount_minor, rule.currency));
      return values.join(' + ');
    };
    const count = Object.keys(rows || {}).length;
    return [pix && 'Pix ' + format(pix), card && 'Cartão ' + format(card), count && (count === 1 ? '1 faixa de parcelas' : count + ' faixas de parcelas')].filter(Boolean).join(' · ');
  }

  document.addEventListener('click', event => {
    const tab = event.target.closest('[data-fee-tab]');
    if (tab) {
      const editor = tab.closest('[data-fee-editor]');
      for (const button of editor.querySelectorAll('[data-fee-tab]')) button.setAttribute('aria-pressed', String(button === tab));
      const bothMethods = tab.dataset.feeTab === 'both';
      for (const panel of editor.querySelectorAll('[data-fee-panel]')) {
        panel.hidden = !bothMethods && panel.dataset.feePanel !== tab.dataset.feeTab;
        panel.querySelector('.mt-fee-method').hidden = !bothMethods;
      }
    }
    event.target.closest('[data-fee-remove-tier]')?.closest('[data-fee-tier]').remove();
  });

  window.MagemindTrackingFees = {fill, read, description};
})();
