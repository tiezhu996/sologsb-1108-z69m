import { defineStore } from 'pinia'
import { db, plain } from '../utils/db'
import type { DevRun } from '../types/dev-run'

type NewRun = Omit<DevRun, 'id' | 'schemaRev'>

export class RunStockError extends Error {}

export interface RevokeResult {
  filmReturned: boolean
  developerReturned: boolean
}

export const useRunStore = defineStore('run', {
  state: () => ({
    runs: [] as DevRun[],
    loading: false
  }),
  getters: {
    recentRuns: (state) => [...state.runs]
      .sort((a, b) => b.runDate.localeCompare(a.runDate))
      .slice(0, 6)
  },
  actions: {
    async load(): Promise<void> {
      this.loading = true
      try {
        this.runs = await db.runs.orderBy('id').reverse().toArray()
      } finally {
        this.loading = false
      }
    },
    /**
     * 保存冲洗记录与库存扣减在同一事务内完成：
     * 胶片余量不足时直接抛出 RunStockError，记录与显影液用量都不会写入。
     */
    async addRun(payload: NewRun): Promise<number> {
      const id = await db.transaction('rw', db.runs, db.recipes, db.films, db.developers, async () => {
        const recipe = await db.recipes.get(payload.recipeId)
        if (!recipe) throw new RunStockError('所选配方不存在，请重新选择')
        const film = await db.films.get(recipe.filmId)
        if (!film || film.id === undefined) throw new RunStockError('配方对应的胶片批次不在台账中，无法保存')
        if (film.rollsLeft <= 0) {
          throw new RunStockError(`${film.model} · ${film.format}（${film.emulsionNo}）已缺货，请补货后再保存冲洗记录`)
        }

        const developer = await db.developers.get(recipe.developerId)
        const chargeDeveloper = !!developer && developer.id !== undefined && developer.state !== '报废'

        const next: DevRun = {
          ...payload,
          filmId: film.id,
          emulsionNo: film.emulsionNo,
          filmConsumed: true,
          developerCharged: chargeDeveloper,
          schemaRev: 3
        }
        const runId = await db.runs.add(plain(next))

        await db.films.update(film.id, plain({ rollsLeft: film.rollsLeft - 1 }))
        if (chargeDeveloper && developer) {
          await db.developers.update(developer.id!, plain({ usedRolls: developer.usedRolls + 1 }))
        }
        return runId
      })
      await this.load()
      return id
    },
    /**
     * 撤销一次冲洗消耗：删除记录，按记录上的快照把一卷胶片退回台账、
     * 一卷显影液用量退回。台账已变化不影响快照判断。
     */
    async revokeRun(runId: number): Promise<RevokeResult> {
      const result = await db.transaction('rw', db.runs, db.recipes, db.films, db.developers, async () => {
        const run = await db.runs.get(runId)
        if (!run) return { filmReturned: false, developerReturned: false }

        let filmReturned = false
        if (run.filmConsumed && run.filmId !== undefined) {
          const film = await db.films.get(run.filmId)
          if (film && film.id !== undefined) {
            await db.films.update(film.id, plain({ rollsLeft: film.rollsLeft + 1 }))
            filmReturned = true
          }
        }

        let developerReturned = false
        if (run.developerCharged) {
          const recipe = await db.recipes.get(run.recipeId)
          if (recipe) {
            const developer = await db.developers.get(recipe.developerId)
            if (developer && developer.id !== undefined && developer.usedRolls > 0) {
              await db.developers.update(developer.id, plain({ usedRolls: developer.usedRolls - 1 }))
              developerReturned = true
            }
          }
        }

        await db.runs.delete(runId)
        return { filmReturned, developerReturned }
      })
      await this.load()
      return result
    },
    async writeBackNote(runId: number, recipeId: number): Promise<void> {
      const run = await db.runs.get(runId)
      if (!run) return
      const note = `${run.runDate} 实冲 ${run.actualTempC}°C / ${run.actualMinutes} 分钟：${run.result}`
      await db.recipes.update(recipeId, plain({ note }))
    }
  }
})
