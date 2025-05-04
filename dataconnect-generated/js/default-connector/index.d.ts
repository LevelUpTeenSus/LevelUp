import { ConnectorConfig } from 'firebase/data-connect';

export const connectorConfig: ConnectorConfig;

export type TimestampString = string;
export type UUIDString = string;
export type Int64String = string;
export type DateString = string;


export interface BehaviorLog_Key {
  id: UUIDString;
  __typename?: 'BehaviorLog_Key';
}

export interface Responsibility_Key {
  id: UUIDString;
  __typename?: 'Responsibility_Key';
}

export interface Reward_Key {
  id: UUIDString;
  __typename?: 'Reward_Key';
}

export interface SubscriptionType_Key {
  id: UUIDString;
  __typename?: 'SubscriptionType_Key';
}

export interface Tier_Key {
  id: UUIDString;
  __typename?: 'Tier_Key';
}

export interface User_Key {
  id: UUIDString;
  __typename?: 'User_Key';
}

