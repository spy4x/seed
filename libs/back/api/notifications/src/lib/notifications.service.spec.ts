const sendToTopicMock = jest.fn();
const subscribeToTopicMock = jest.fn();
const unsubscribeFromTopicMock = jest.fn();
jest.mock('firebase-admin', () => ({
  apps: [{}],
  initializeApp: jest.fn(),
  messaging: () => ({
    sendToTopic: sendToTopicMock,
    subscribeToTopic: subscribeToTopicMock,
    unsubscribeFromTopic: unsubscribeFromTopicMock,
  }),
}));

import { NotificationType } from '@prisma/client';
import { AllTopic, NotificationsService, UserTopic } from './notifications.service';

describe(NotificationsService.name, () => {
  const service = new NotificationsService();

  it(NotificationsService.prototype.sendToTopic.name, async () => {
    const title = 'title';
    const body = 'body';
    const data = { type: NotificationType.WELCOME };
    await service.sendToTopic(AllTopic, title, body, data);
    expect(sendToTopicMock).toBeCalledWith(
      AllTopic.name,
      {
        notification: {
          title,
          body,
        },
        data,
      },
      {
        mutableContent: false,
      },
    );
  });

  it(NotificationsService.prototype.subscribeToTopics.name, async () => {
    const tokens = ['token1', 'token2'];
    const topics = [AllTopic, new UserTopic('userId')];

    await service.subscribeToTopics(tokens, topics);

    topics.forEach(topic => {
      expect(subscribeToTopicMock).toBeCalledWith(tokens, topic.name);
    });
  });

  it(NotificationsService.prototype.unsubscribeFromTopics.name, async () => {
    const tokens = ['token1', 'token2'];
    const topics = [AllTopic, new UserTopic('userId')];

    await service.unsubscribeFromTopics(tokens, topics);

    topics.forEach(topic => {
      expect(unsubscribeFromTopicMock).toBeCalledWith(tokens, topic.name);
    });
  });
});
