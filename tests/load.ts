import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Packet } from '../src/domain/types';
import { buildIndex } from '../src/domain/packetIndex';

export const packetPath = resolve(__dirname, '../public/data/okafor_lindqvist_2025_packet.json');
export const packet: Packet = JSON.parse(readFileSync(packetPath, 'utf-8'));
export const ix = buildIndex(packet);
