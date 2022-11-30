import { messaging } from 'firebase-admin';
import { LogService } from '@seed/back/api/shared';
import { NotificationType } from '@prisma/client';

class Topic {
  constructor(public name: string) {}
}
export const AllTopic = new Topic(`all`);
export class UserTopic extends Topic {
  constructor(public userId: string) {
    super(`user_${userId}`);
  }
}
export class ChatTopic extends Topic {
  constructor(public chatId: string) {
    super(`chat_${chatId}`);
  }
}

export class NotificationsService {
  private readonly messaging: messaging.Messaging;

  private readonly logService = new LogService(NotificationsService.name);

  constructor() {
    this.messaging = messaging();
  }

  async sendToTopic(
    topic: Topic,
    title: string,
    body: string,
    data: { [key: string]: string } & { type: NotificationType },
    mutableContent = false,
  ): Promise<void> {
    await this.logService.trackSegment(
      this.sendToTopic.name,
      async logSegment => {
        const message: messaging.MessagingPayload = {
          notification: {
            title,
            body,
          },
          data,
        };

        logSegment.log('Sending message', {
          topic,
          message,
        });

        return this.messaging.sendToTopic(topic.name, message, {
          mutableContent,
        });
      },
      null,
      true,
    );
  }

  async subscribeToTopics(tokens: string[], topics: Topic[]): Promise<void> {
    await this.logService.trackSegment(
      this.subscribeToTopics.name,
      async () => {
        const promises = topics.map(async topic => this.messaging.subscribeToTopic(tokens, topic.name));
        await Promise.all(promises);
      },
      { tokens, topics: topics.map(topic => topic.name) },
    );
  }

  async unsubscribeFromTopics(tokens: string[], topics: Topic[]): Promise<void> {
    await this.logService.trackSegment(
      this.unsubscribeFromTopics.name,
      async () => {
        const promises = topics.map(async topic => this.messaging.unsubscribeFromTopic(tokens, topic.name));
        await Promise.all(promises);
      },
      { tokens, topics: topics.map(topic => topic.name) },
    );
  }
}
