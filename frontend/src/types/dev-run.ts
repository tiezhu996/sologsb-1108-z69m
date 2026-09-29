import type { FilmStock } from './film-stock'

export type TankType = '双联罐' | '深罐'

export interface DevRun {
  id?: number
  batchNo: string
  recipeId: number
  actualTempC: number
  actualMinutes: number
  tankType: TankType
  runDate: string
  result: string
  /** 保存记录时所选配方对应的胶片批次（乳剂批号快照，后续胶片台账变化不追改历史） */
  filmId?: number
  emulsionNo?: string
  /** 该记录是否仍占用一卷胶片与一卷显影液用量；撤销消耗后置为 false */
  consumed?: boolean
  schemaRev?: number
}

/** 配方对应胶片余量不足，整次保存（记录与显影液用量）中止 */
export class RunStockShortError extends Error {
  readonly film: Pick<FilmStock, 'model' | 'format'> | undefined

  constructor(message: string, film?: Pick<FilmStock, 'model' | 'format'>) {
    super(message)
    this.name = 'RunStockShortError'
    this.film = film
  }
}
