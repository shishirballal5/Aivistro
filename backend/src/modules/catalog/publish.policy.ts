import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DomainCode } from '../../common/constants/error-codes';
import { DomainException } from '../../common/errors';
import { ContentStatus, Episode, Series, VideoAsset, VideoStatus } from '../../database/entities/index';

/** Rules a series or episode must satisfy before viewers can see it. */
@Injectable()
export class PublishPolicy {
  constructor(
    @InjectRepository(Series) private readonly series: Repository<Series>,
    @InjectRepository(Episode) private readonly episodes: Repository<Episode>,
    @InjectRepository(VideoAsset) private readonly assets: Repository<VideoAsset>,
  ) {}

  async assertSeriesPublishable(s: Series): Promise<void> {
    const problems: string[] = [];
    if (!s.title.trim()) problems.push('A title is required');
    if (s.synopsis.trim().length < 10) problems.push('A synopsis of at least 10 characters is required');
    if (!s.posterKey) problems.push('A poster image is required');
    const full = await this.series.findOne({ where: { id: s.id }, relations: { genres: true } });
    if (!full?.genres.length) problems.push('At least one genre is required');
    const live = await this.episodes.count({ where: { seriesId: s.id, status: ContentStatus.Published } });
    if (!live) problems.push('At least one published episode is required');
    this.throwIfAny(problems);
  }

  /** An episode can only go live once its video has been processed and verified (status READY). */
  async assertEpisodePublishable(e: Episode): Promise<void> {
    const problems: string[] = [];
    if (!e.title.trim()) problems.push('A title is required');
    const asset = e.currentAssetId ? await this.assets.findOne({ where: { id: e.currentAssetId } }) : null;
    if (!asset) problems.push('A processed video is required: upload a video and wait for processing to finish');
    else if (asset.status !== VideoStatus.Ready) problems.push(`The video is not ready (status ${asset.status})`);
    this.throwIfAny(problems);
  }

  private throwIfAny(problems: string[]): void {
    if (problems.length) throw new DomainException(HttpStatus.UNPROCESSABLE_ENTITY, DomainCode.PublishValidationFailed, 'This item cannot be published yet', { details: problems });
  }
}
