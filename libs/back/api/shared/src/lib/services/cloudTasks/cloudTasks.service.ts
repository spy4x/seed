import { Injectable } from '@nestjs/common';
import { CloudTasksClient } from '@google-cloud/tasks';
import { google } from '@google-cloud/tasks/build/protos/protos';
import ITask = google.cloud.tasks.v2.ITask;
import { LogService } from '../log/log.service';
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
    this._logger.log(`Start with`, {
      queueName,
      taskId,
      urlToTrigger,
      whenToTrigger,
      payload,
    });
    const client = new CloudTasksClient();

    const parent = client.queuePath(API_CONFIG.projectId, API_CONFIG.dataCenterLocation, queueName);

    const task: ITask = {
      httpRequest: {
        httpMethod: 'POST',
        url: urlToTrigger,
        headers: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'Content-Type': 'application/json',
        },
        body: payload ? Buffer.from(JSON.stringify(payload)).toString('base64') : undefined,
      },
      name: `projects/${API_CONFIG.projectId}/locations/${API_CONFIG.dataCenterLocation}/queues/${queueName}/tasks/${taskId}`,
      scheduleTime: {
        seconds: whenToTrigger.getTime() / MILLISECONDS_IN_SECOND,
      },
    };
    this._logger.log(`Creating`, { parent, task });
    const result = await client.createTask({ parent, task });
    this._logger.log('Created', result);
  }
}
