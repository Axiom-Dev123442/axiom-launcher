/** Account switcher, Microsoft sign in and offline account dialogs. */
import { h, btn, iconBtn, spinner } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { call, onMain, state, refreshAccounts, activeAccount } from '../lib/store.js';
import { popover, modal, toast, showError, confirmDialog } from '../lib/ui.js';
import { accountHead, headCanvas, defaultSkin } from '../lib/skin.js';
import { navigate } from '../router.js';

export function accountMenu(anchor) {
  popover(
    anchor,
    (close) => {
      const list = h('div');
      for (const acc of state.accounts) {
        list.append(
          h(
            'div.acc-item',
            {
              onclick: async () => {
                await call('accounts:setActive', acc.id);
                await refreshAccounts();
                close();
              },
            },
            accountHead(acc, 'head sm'),
            h('div.meta', h('div.n', acc.name), h('div.t', acc.type === 'microsoft' ? (acc.needsLogin ? 'Microsoft · sign in again' : 'Microsoft') : 'Offline')),
            acc.active ? icon('check', 'check') : null,
            iconBtn('trash', {
              cls: 'rm',
              title: 'Remove account',
              onClick: async (e) => {
                e.stopPropagation();
                close();
                const ok = await confirmDialog({
                  title: `Remove ${acc.name}?`,
                  message: 'You can add the account again at any time.',
                  confirm: 'Remove',
                  danger: true,
                });
                if (!ok) return;
                await call('accounts:remove', acc.id);
                await refreshAccounts();
              },
            }),
          ),
        );
      }
      return h(
        'div',
        { style: 'width:270px' },
        state.accounts.length ? [h('div.menu-title', 'Accounts'), list, h('div.menu-sep')] : null,
        h(
          'button.menu-item',
          {
            onclick: () => {
              close();
              microsoftLogin();
            },
          },
          icon('key'),
          'Add Microsoft account',
        ),
        h(
          'button.menu-item',
          {
            onclick: () => {
              close();
              offlineDialog();
            },
          },
          icon('user'),
          'Add offline account',
        ),
        activeAccount()
          ? h(
              'button.menu-item',
              {
                onclick: () => {
                  close();
                  navigate({ page: 'skins' });
                },
              },
              icon('shirt'),
              'Change skin',
            )
          : null,
      );
    },
    { placement: 'top-start' },
  );
}

export function offlineDialog() {
  return modal((close) => {
    const preview = headCanvas(defaultSkin(), 'head lg');
    const input = h('input.input', { placeholder: 'Steve', maxlength: '16', spellcheck: 'false' });
    const error = h('div.hint');
    const submit = async () => {
      try {
        await call('accounts:addOffline', input.value);
        await refreshAccounts();
        toast(`Playing as ${input.value.trim()}`, { kind: 'success', message: 'Offline accounts work in singleplayer and on cracked servers.' });
        close(true);
      } catch (err) {
        error.textContent = err.message;
        error.style.color = 'var(--danger)';
      }
    };
    input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
    return {
      title: 'Add offline account',
      body: h(
        'div',
        h('div.row', { style: 'gap:16px;margin-bottom:18px' }, preview, h('p.muted', { style: 'margin:0' }, 'Pick any username. Offline accounts can’t join servers that check for a paid account.')),
        h('div.field', { style: 'margin:0' }, h('label', 'Username'), input, error),
      ),
      footer: [btn('Cancel', { cls: 'ghost', onClick: () => close(false) }), btn('Add account', { cls: 'primary', icon: 'check', onClick: submit })],
    };
  });
}

export async function microsoftLogin() {
  if (!state.info.hasMicrosoftId) {
    const go = await confirmDialog({
      title: 'Microsoft login needs setting up',
      message: 'Microsoft requires every launcher to have its own app ID. Add yours in Settings → Accounts, it only takes a few minutes. Offline accounts work without it.',
      confirm: 'Open settings',
    });
    if (go) navigate({ page: 'settings', section: 'accounts' });
    return;
  }
  // Sign in through Microsoft's own page; only pressing Accept is needed.
  let failed = false;
  const result = await modal((close) => {
    call('accounts:loginMicrosoftBrowser')
      .then(async () => {
        await refreshAccounts();
        const acc = activeAccount();
        toast(`Signed in as ${acc ? acc.name : 'Microsoft account'}`, { kind: 'success' });
        close('done');
      })
      .catch((err) => {
        if (!err.cancelled && err.name !== 'AbortError') {
          failed = true;
          showError(err, 'Microsoft sign in failed');
        }
        close('cancelled');
      });
    return {
      title: 'Sign in with Microsoft',
      icon: icon('key'),
      sticky: true,
      body: h(
        'div',
        { style: 'text-align:center;padding:10px 0 4px' },
        h('div.row', { style: 'justify-content:center;gap:10px;margin-bottom:14px' }, spinner(), h('b', 'Finish signing in in the Microsoft window')),
        h('p.muted', { style: 'margin:0' }, 'Pick your account and press Accept. The window closes by itself when you’re done.'),
      ),
      footer: [
        btn('Use a code instead', {
          cls: 'ghost',
          onClick: () => {
            call('accounts:cancelLogin');
            close('code');
          },
        }),
        btn('Cancel', {
          onClick: () => {
            call('accounts:cancelLogin');
            close('cancelled');
          },
        }),
      ],
    };
  });
  if (result !== 'code' || failed) return;
  return microsoftCodeLogin();
}

/** Fallback sign in with a code entered at microsoft.com/link. */
export async function microsoftCodeLogin() {
  let offCode = null;
  modal((close) => {
    const body = h('div.center', spinner('lg'));
    offCode = onMain('login-code', (code) => {
      const chars = code.userCode.split('');
      body.replaceChildren(
        h(
          'div',
          { style: 'text-align:center;width:100%' },
          h('p.muted', { style: 'margin:0' }, 'Go to the Microsoft page and enter this code:'),
          h('div.code-box', chars.map((c) => h('span', c))),
          h(
            'div.row',
            { style: 'justify-content:center' },
            btn('Copy code and open page', {
              cls: 'primary',
              icon: 'external',
              onClick: () => {
                navigator.clipboard.writeText(code.userCode).catch(() => {});
                call('app:openExternal', code.verificationUri);
              },
            }),
          ),
          h('div.row', { style: 'justify-content:center;margin-top:20px;gap:10px' }, spinner(), h('span.dim', 'Waiting for you to sign in…')),
        ),
      );
    });
    call('accounts:loginMicrosoft')
      .then(async () => {
        await refreshAccounts();
        const acc = activeAccount();
        toast(`Signed in as ${acc ? acc.name : 'Microsoft account'}`, { kind: 'success' });
        close(true);
      })
      .catch((err) => {
        if (!err.cancelled) showError(err, 'Microsoft sign in failed');
        close(false);
      });
    return {
      title: 'Sign in with Microsoft',
      icon: icon('key'),
      sticky: true,
      body,
      footer: [btn('Cancel', { cls: 'ghost', onClick: () => close(false) })],
    };
  }).then(() => {
    if (offCode) offCode();
    call('accounts:cancelLogin');
  });
}
