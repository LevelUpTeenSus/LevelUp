function buildBoardChild(elements) {
  const { board, tiers } = elements;
  board.innerHTML = '';
  CONFIG.TIER_CONFIG.forEach(tier => {
    const tierData = tiers[tier.id];
    if (!tierData) return;
    const section = document.createElement('section');
    const header = document.createElement('h2');
    header.textContent = `Tier ${tier.id}: ${tier.name}`;
    section.append(header);

    // Responsibilities for this tier
    const respUl = document.createElement('ul');
    respUl.className = 'responsibilities';
    tierData.responsibilities.forEach(text => {
      const li = document.createElement('li');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.onchange = () => handleCompletion(text, li);
      const span = document.createElement('span');
      span.textContent = text;
      const badge = document.createElement('span');
      badge.className = 'streak-badge';
      badge.textContent = '—';
      li.append(cb, span, badge);
      respUl.append(li);
      loadResponsibilityStreakFor(li, text);
    });
    section.append(respUl);

    // Privileges for this tier
    const privUl = document.createElement('ul');
    privUl.className = 'privileges';
    tierData.privileges.forEach(text => {
      const li = document.createElement('li');
      li.textContent = text;
      privUl.append(li);
    });
    section.append(privUl);

    board.append(section);
  });
}