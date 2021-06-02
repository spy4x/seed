import { Injectable } from '@nestjs/common';
import { CloudTasksClient } from '@google-cloud/tasks';
import { google } from '@google-cloud/tasks/build/protos/protos';
import ITask = google.cloud.tasks.v2.ITask;
import { LogSegment, LogService } from '../log/log.service';
import { API_CONFIG } from '../../constants';
import { MILLISECONDS_IN_SECOND } from '@seed/shared/constants';

@Injectable()
export class CloudTasksService {
  private readonly _logger = new LogService(CloudTasksService.name);

  async create(
    queueName: string,
    taskId: string,
    urlToTrigger: string,
    whenToTrigger: Date,
    payload?: unknown,
  ): Promise<void> {
    const startWithParams = {
      queueName,
      taskId,
      urlToTrigger,
      whenToTrigger,
      payload,
    };

    const handler = async (logSegment: LogSegment): Promise<void> => {
      const client = new CloudTasksClient();
      const parent = client.queuePath(API_CONFIG.projectId, API_CONFIG.dataCenterRegion, queueName);
      const task: ITask = {
        httpRequest: {
          httpMethod: 'POST',
          url: urlToTrigger,
          headers: {
            'Content-Type': 'application/json',
          },
          body: payload ? Buffer.from(JSON.stringify(payload)).toString('base64') : undefined,
        },
        name: `projects/${API_CONFIG.projectId}/locations/${API_CONFIG.dataCenterRegion}/queues/${queueName}/tasks/${taskId}`,
        scheduleTime: {
          seconds: whenToTrigger.getTime() / MILLISECONDS_IN_SECOND,
        },
      };
      logSegment.log(`Creating`, { parent, task });
      await client.createTask({ parent, task });
    };

    return this._logger.trackSegment<void>(this.create.name, handler, startWithParams);
  }
}
