import React from 'react';
import { render } from 'ink';
import { TuiApp } from './app.js';
import { XiaobaiAgent } from '../../core/agent.js';
import { printBanner } from '../renderer.js';

export async function startTui(agent: XiaobaiAgent, options?: { model?: string; auto?: boolean }): Promise<void> {
  printBanner();

  const instance = render(
    React.createElement(TuiApp, {
      agent,
      model: options?.model,
      auto: options?.auto,
    }),
  );

  await instance.waitUntilExit();
}
