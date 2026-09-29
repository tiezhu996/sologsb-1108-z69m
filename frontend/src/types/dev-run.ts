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
  /** 保存时配方对应的胶片批次（快照，台账后续变化不追改历史） */
  filmId?: number
  /** 保存时定格的乳剂批号 */
  emulsionNo?: string
  /** 本次是否实际扣减过一卷胶片（升级前历史记录为 false） */
  filmConsumed?: boolean
  /** 本次是否实际计入过一卷显影液用量（升级前历史记录为 false） */
  developerCharged?: boolean
  schemaRev?: number
}
